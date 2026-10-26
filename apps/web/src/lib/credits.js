/**
 * Credit codes and invites.
 *
 * Two house packages over this site's Postgres, writing into the ledger it already has:
 *
 * - @profullstack/redeem-credits mints scarce codes (stored only as sha256 hashes) that
 *   grant credits (one per full-resolution cutout). bg0ne keeps its own balance
 *   (credit_ledger), so the
 *   package is used for minting and redeeming only; the credits land in credit_ledger,
 *   keyed on (user, 'code:<id>'), and the package's balance()/spend() are never called.
 * - @profullstack/affiliates gives every account three single-use invites and one open
 *   ?ref= code, and records who brought whom.
 *
 * An accepted invite pays credits to both people, but only when this sign-in created the
 * account (so the address is new and confirmed), the two are not one mailbox, the new
 * address is not a throwaway one, the inviter's account is old enough and the inviter
 * is under a monthly cap.
 */

import { sql } from '@bg0ne/db';
import * as q from '@bg0ne/db/queries';
import {
  Affiliates,
  postgresStore as affiliateStore,
  normalizeCode as normalizeInvite,
} from '@profullstack/affiliates';
import { Credits, postgresStore as creditStore } from '@profullstack/redeem-credits';

export { REF_COOKIE } from '@profullstack/affiliates';

/** The unit every code grants: one credit, one full-resolution cutout, the same thing a top-up buys. */
export const UNIT = 'credits';
/** Invites per account. Scarce on purpose: an invite says someone wanted you here. */
export const INVITE_QUOTA = 3;
/** Where an /i/<code> visit is remembered until the emailed link is sent. */
export const INVITE_COOKIE = 'bg_invite';
/** Bonuses one inviter can earn in 30 days, whatever their quota is raised to. */
export const INVITER_MONTHLY_CAP = 10;

const envNumber = (name, fallback) => {
  const raw = process.env[name];
  const n = raw === undefined || raw === '' ? fallback : Number(raw);
  return Number.isFinite(n) ? n : fallback;
};
/** Credits each side of an accepted invite gets. 0 turns the bonus off. */
export const inviteBonusCredits = () =>
  Math.max(0, Math.floor(envNumber('INVITE_BONUS_CREDITS', 10)));
const inviterMinAgeHours = () => envNumber('INVITE_MIN_INVITER_AGE_HOURS', 24);

/**
 * Bun's SQL client as the node-postgres `query(text, params) -> { rows }` both packages
 * take. Each statement runs on its own; neither package relies on two sharing a
 * connection.
 */
const pool = {
  async query(text, params = []) {
    return { rows: await sql.unsafe(text, params) };
  },
};

let services;
function svc() {
  services ??= {
    // prefix redeem_: the default credit_ would collide with our own credit_ledger.
    credits: new Credits(creditStore(pool, { prefix: 'redeem_' })),
    affiliates: new Affiliates(affiliateStore(pool), { defaultQuota: INVITE_QUOTA }),
  };
  return services;
}

/* --------------------------------------------------------------- input -- */

/** A code as typed, or null. The packages forgive case, spaces and dashes; this only
 *  keeps junk (and anything long enough to be an attack on a log line) out. */
export function cleanCode(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > 48) return null;
  return /^[A-Za-z0-9 _-]+$/.test(trimmed) ? trimmed : null;
}

/** An affiliate code from ?ref= or the cookie: short, letters and digits. */
export function cleanRef(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9]{4,32}$/.test(trimmed) ? trimmed.toUpperCase() : null;
}

/** The canonical spelling of an invite, for a cookie and a URL. Null when it cannot be one. */
export function canonicalInvite(value) {
  const cleaned = cleanCode(value);
  if (!cleaned) return null;
  const normal = normalizeInvite(cleaned);
  return /^INV-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(normal) ? normal : null;
}

/* -------------------------------------------------------------- credit -- */

export const REDEEM_MESSAGES = {
  invalid: 'That code does not exist. Check it and try again.',
  expired: 'That code has expired.',
  used_up: 'That code has already been used.',
  already_redeemed: 'You have already redeemed that code.',
  revoked: 'That code has been withdrawn.',
};

/**
 * Redeem a code for this account. On success the credits are in credit_ledger before
 * this returns. `already_redeemed` also re-runs the mirror, so a redemption whose
 * ledger write was lost to a crash is paid on the next try instead of being stuck.
 */
export async function redeemCode(userId, code) {
  const cleaned = cleanCode(code);
  if (!cleaned) return { ok: false, reason: 'invalid', message: REDEEM_MESSAGES.invalid };
  const r = await svc().credits.redeem(cleaned, String(userId));
  if (!r.ok) {
    if (r.reason === 'already_redeemed') await q.reconcileCodeGrants(userId).catch(() => 0);
    return { ok: false, reason: r.reason, message: REDEEM_MESSAGES[r.reason] };
  }
  await q.reconcileCodeGrants(userId);
  const credits = r.grant.unit === UNIT ? Math.round(r.grant.amount) : 0;
  return { ok: true, credits, balance: await q.creditBalance(userId) };
}

/** An operator mints a code. The plaintext is in the result and nowhere else. */
export async function mintCode({
  credits,
  label,
  maxRedemptions = 1,
  expiresInDays = null,
  createdBy,
}) {
  if (!Number.isInteger(credits) || credits <= 0 || credits > 1_000_000) {
    throw new Error('credits must be a whole number from 1 to 1000000');
  }
  if (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 10_000) {
    throw new Error('max redemptions must be a whole number from 1 to 10000');
  }
  // One-off grants only: credit_ledger has no monthly allowance, and a monthly code
  // would be paid once and then silently never again.
  return svc().credits.mint({
    grant: { unit: UNIT, amount: credits },
    label:
      String(label ?? '')
        .trim()
        .slice(0, 120) || 'bg0ne credits',
    maxRedemptions,
    expiresAt: expiresInDays ? Date.now() + expiresInDays * 86_400_000 : null,
    prefix: 'BG',
    ...(createdBy ? { createdBy } : {}),
  });
}

export const listCodes = () => svc().credits.list();
export const revokeCode = (id) => svc().credits.revoke(id);

/* ------------------------------------------------------------- invites -- */

/** Links are built from SITE_URL, or from the request if SITE_URL was left at localhost. */
export function originFor(siteUrl, requestUrl) {
  if (siteUrl && !/\/\/(localhost|127\.0\.0\.1)(:|$)/.test(siteUrl)) return siteUrl;
  try {
    return new URL(requestUrl).origin;
  } catch {
    return siteUrl;
  }
}

const iso = (ms) => (ms == null ? null : new Date(Number(ms)).toISOString());

function inviteView(invite) {
  return {
    id: invite.id,
    note: invite.note,
    created_at: iso(invite.createdAt),
    expires_at: iso(invite.expiresAt),
    used: invite.usedBy !== null,
    used_at: iso(invite.usedAt),
    revoked: (invite.revokedAt ?? null) !== null,
  };
}

export async function inviteSummary(userId, origin) {
  const { affiliates } = svc();
  const id = String(userId);
  const [quota, invites, affiliateCode, invitees] = await Promise.all([
    affiliates.quota(id),
    affiliates.invites(id),
    affiliates.affiliateCode(id),
    affiliates.invitees(id),
  ]);
  return {
    quota,
    bonus_credits: inviteBonusCredits(),
    invites: invites.map(inviteView),
    affiliate_code: affiliateCode,
    affiliate_url: `${origin}/?ref=${affiliateCode}`,
    joined: invitees.length,
  };
}

export async function createInvite(userId, note, origin) {
  const { affiliates } = svc();
  try {
    const invite = await affiliates.createInvite(
      String(userId),
      String(note ?? '')
        .trim()
        .slice(0, 120),
    );
    return {
      ok: true,
      code: invite.code,
      url: `${origin}/i/${encodeURIComponent(invite.code)}`,
      invite: inviteView(invite),
      quota: await affiliates.quota(String(userId)),
    };
  } catch (err) {
    if (/no invites left/i.test(String(err?.message)))
      return { ok: false, reason: 'no_invites_left' };
    throw err;
  }
}

/**
 * One mailbox under two spellings: case, a +tag, and Gmail's dots. Inviting yourself to
 * collect both halves of the bonus is what this catches; a second domain is what the
 * throwaway list and the monthly cap are for.
 */
export function sameMailbox(a, b) {
  const canonical = (email) => {
    const [rawLocal = '', rawDomain = ''] = String(email).trim().toLowerCase().split('@');
    let domain = rawDomain;
    let local = rawLocal.split('+')[0] ?? '';
    if (domain === 'googlemail.com') domain = 'gmail.com';
    if (domain === 'gmail.com') local = local.replaceAll('.', '');
    return `${local}@${domain}`;
  };
  return canonical(a) === canonical(b);
}

/** Disposable-mail services: an account made on one earns its inviter nothing. */
const THROWAWAY = new Set([
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  'anonaddy.me',
  'burnermail.io',
  'byom.de',
  'discard.email',
  'dispostable.com',
  'dropmail.me',
  'emailondeck.com',
  'fakeinbox.com',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'grr.la',
  'harakirimail.com',
  'inboxbear.com',
  'incognitomail.org',
  'mail.tm',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailinator.net',
  'mailnesia.com',
  'mailpoof.com',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'nada.email',
  'sharklasers.com',
  'spam4.me',
  'spamgourmet.com',
  'temp-mail.io',
  'temp-mail.org',
  'tempail.com',
  'tempmail.com',
  'tempmail.net',
  'tempmailo.com',
  'tempr.email',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.de',
  'trashmail.net',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
]);

export function isThrowaway(email) {
  const domain = String(email).trim().toLowerCase().split('@')[1] ?? '';
  return THROWAWAY.has(domain) || [...THROWAWAY].some((d) => domain.endsWith(`.${d}`));
}

/**
 * Accept an invite for an account this sign-in just created.
 *
 * The caller is the magic-link callback, so the invitee's address is confirmed by
 * construction. The invite is spent whatever the bonus decides: who invited whom is
 * recorded even when nothing is paid for it.
 */
export async function acceptInvite(code, invitee) {
  const { affiliates } = svc();
  const invite = await affiliates.redeemInvite(code, String(invitee.id));
  if (!invite.ok) return { invite, bonus: null, credits: 0 };

  const bonus = inviteBonusCredits();
  const [inviter] = await sql`
    select u.id, u.email::text as email,
           extract(epoch from (now() - u.created_at)) / 3600 as age_hours,
           (select count(*)::int from invite_bonuses b
             where b.user_id = u.id and b.role = 'inviter' and b.status = 'granted'
               and b.created_at > now() - interval '30 days') as recent
    from users u where u.id::text = ${invite.inviterId}
  `;

  let status = 'granted';
  if (bonus <= 0 || !inviter) status = 'disabled';
  else if (sameMailbox(inviter.email, invitee.email)) status = 'same_mailbox';
  else if (isThrowaway(invitee.email)) status = 'throwaway_address';
  else if (Number(inviter.age_hours) < inviterMinAgeHours()) status = 'inviter_too_new';
  else if (Number(inviter.recent) >= INVITER_MONTHLY_CAP) status = 'inviter_cap';

  const credits = status === 'granted' ? bonus : 0;
  const pairs = [[invitee.id, 'invitee'], ...(inviter ? [[inviter.id, 'inviter']] : [])];
  let paid = 0;
  for (const [userId, role] of pairs) {
    // The row is claimed first, so a retry never pays twice.
    const claimed = await sql`
      insert into invite_bonuses (invite_id, user_id, role, credits, status)
      values (${invite.inviteId}, ${userId}, ${role}, ${credits}, ${status === 'granted' ? 'pending' : status})
      on conflict do nothing returning invite_id
    `;
    if (claimed.length === 0 || status !== 'granted') continue;
    await q.grantFromSource({
      userId,
      credits,
      source: `invite:${invite.inviteId}`,
      reason: role === 'invitee' ? 'invite bonus (joined)' : 'invite bonus (invited a friend)',
    });
    await sql`
      update invite_bonuses set status = 'granted'
      where invite_id = ${invite.inviteId} and user_id = ${userId}
    `;
    if (role === 'invitee') paid = credits;
  }
  return { invite, bonus: status, credits: paid };
}

/** First touch: an account already attributed keeps its first affiliate. */
export async function attributeRef(ref, userId) {
  const code = cleanRef(ref);
  if (!code) return { ok: false };
  return svc().affiliates.attribute(code, String(userId));
}

/** Admin: raise or lower a user's invite allowance (a total, not an increment). */
export const setInviteQuota = (userId, total) => svc().affiliates.setQuota(String(userId), total);
