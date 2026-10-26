import { beforeAll, beforeEach, expect, test } from 'bun:test';
import * as auth from '../../../packages/auth/src/index.js';
import { sql } from '../../../packages/db/src/index.js';
import * as q from '../../../packages/db/src/queries.js';

/**
 * Credit codes and invites, written into the ledger bg0ne already has.
 *
 * What matters: a code pays an account once, into credit_ledger; an invite pays both
 * sides once, only for a new confirmed account, and not when the checks say no.
 * No afterAll(close): the pool is shared by every test file in the process.
 */

let app;
let credits;

beforeAll(async () => {
  process.env.INVITE_BONUS_CREDITS = '30';
  ({ app } = await import('../src/app.js'));
  credits = await import('../src/lib/credits.js');
  // The affiliates package makes its tables on first use; make them before truncating.
  await credits.inviteSummary('00000000-0000-0000-0000-000000000000', 'https://bg0ne.com');
});

beforeEach(async () => {
  await sql`truncate credit_ledger, cutouts, payments, sessions, api_keys, login_tokens,
    invite_bonuses, users restart identity cascade`;
  await sql`truncate redeem_codes, redeem_redemptions, redeem_ledger, redeem_accounts`;
  await sql`truncate aff_invites, aff_quotas, aff_codes, aff_attributions`;
});

const oldUser = async (email) => {
  const user = await q.findOrCreateUser(email);
  await sql`update users set created_at = now() - interval '3 days' where id = ${user.id}`;
  return user;
};

const sessionFor = async (user) =>
  `bg0ne_session=${await q.startSession({ userId: user.id, ttlDays: 1 })}`;

/** Spend an emailed link the way a browser would, and return where it landed. */
async function signInThroughLink(email, opts) {
  const url = new URL(await auth.createLoginLink(email, opts));
  const res = await app.request(`/auth/magic${url.search}`);
  const [user] = await sql`select id from users where email = ${email}`;
  return { res, userId: user?.id };
}

/* ------------------------------------------------------------------ codes -- */

test('a code adds its credits to credit_ledger once, and only once', async () => {
  const user = await oldUser('ada@acme.com');
  const minted = await credits.mintCode({ credits: 120, label: 'for Ada' });
  expect(minted.code).toMatch(/^BG-/);

  const first = await credits.redeemCode(user.id, minted.code.toLowerCase().replaceAll('-', ' '));
  expect(first).toMatchObject({ ok: true, credits: 120, balance: 120 });

  const again = await credits.redeemCode(user.id, minted.code);
  expect(again).toMatchObject({ ok: false, reason: 'already_redeemed' });
  expect(await q.creditBalance(user.id)).toBe(120);

  const other = await oldUser('bob@acme.com');
  expect(await credits.redeemCode(other.id, minted.code)).toMatchObject({
    ok: false,
    reason: 'used_up',
  });
  expect(await credits.redeemCode(other.id, 'BG-0000-0000-0000-0000')).toMatchObject({
    ok: false,
    reason: 'invalid',
  });

  const [row] =
    await sql`select delta, reason, source from credit_ledger where user_id = ${user.id}`;
  expect(row).toMatchObject({ delta: 120, reason: 'credit code', source: `code:${minted.id}` });
  // Only the hash is stored.
  const [stored] = await sql`select hash from redeem_codes where id = ${minted.id}`;
  expect(stored.hash).not.toContain(minted.code);
});

test('a redemption whose ledger write was lost is paid on the next try', async () => {
  const user = await oldUser('ada@acme.com');
  const minted = await credits.mintCode({ credits: 45 });
  await credits.redeemCode(user.id, minted.code);
  await sql`delete from credit_ledger where user_id = ${user.id}`;
  expect(await q.creditBalance(user.id)).toBe(0);
  expect((await credits.redeemCode(user.id, minted.code)).reason).toBe('already_redeemed');
  expect(await q.creditBalance(user.id)).toBe(45);
});

test('a multi-use code pays each account once, then is used up', async () => {
  const minted = await credits.mintCode({ credits: 10, maxRedemptions: 2 });
  const a = await oldUser('a@acme.com');
  const b = await oldUser('b@acme.com');
  const c = await oldUser('c@acme.com');
  const results = await Promise.all([a, b, c].map((u) => credits.redeemCode(u.id, minted.code)));
  expect(results.filter((r) => r.ok)).toHaveLength(2);
  const [{ n }] = await sql`select coalesce(sum(delta), 0)::int as n from credit_ledger`;
  expect(n).toBe(20);
});

test('the account page form and the API both redeem', async () => {
  const user = await oldUser('ada@acme.com');
  const cookie = await sessionFor(user);
  const minted = await credits.mintCode({ credits: 60 });

  const page = await (await app.request('/account', { headers: { cookie } })).text();
  expect(page).toContain('Have a code?');
  expect(page).toContain('action="/account/redeem"');

  const body = new FormData();
  body.set('code', minted.code);
  const res = await app.request('/account/redeem', { method: 'POST', body, headers: { cookie } });
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('/account?redeemed=60#code');

  const api = await app.request('/api/v1/credits/redeem', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ code: minted.code }),
  });
  expect(api.status).toBe(409);
  expect((await api.json()).reason).toBe('already_redeemed');

  const anon = await app.request('/api/v1/credits/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: minted.code }),
  });
  expect(anon.status).toBe(401);
});

test('a code cannot be minted for nothing or for a monthly allowance', async () => {
  await expect(credits.mintCode({ credits: 0 })).rejects.toThrow();
  await expect(credits.mintCode({ credits: 1.5 })).rejects.toThrow();
});

/* ---------------------------------------------------------------- invites -- */

async function inviteFrom(inviter) {
  const made = await credits.createInvite(inviter.id, 'for a friend', 'https://bg0ne.com');
  expect(made.ok).toBe(true);
  return made;
}

test('an invite opened in another browser pays both sides once', async () => {
  const inviter = await oldUser('ada@acme.com');
  const { code, url } = await inviteFrom(inviter);
  expect(url).toBe(`https://bg0ne.com/i/${code}`);

  // The landing page: open past every gate, invite in a cookie and in the form.
  const landing = await app.request(`/i/${code.toLowerCase()}`);
  expect(landing.status).toBe(200);
  expect(landing.headers.get('set-cookie')).toContain(`bg_invite=${code}`);
  expect(await landing.text()).toContain(`name="invite" value="${code}"`);

  // Asking for the link stores the invite on it...
  const form = new FormData();
  form.set('email', 'grace@other.org');
  form.set('invite', code);
  await app.request('/auth/link', { method: 'POST', body: form });
  const [token] = await sql`select invite_code from login_tokens where email = 'grace@other.org'`;
  expect(token.invite_code).toBe(code);

  // ...so spending it in a browser with no cookie still counts.
  const { res, userId } = await signInThroughLink('grace@other.org', { inviteCode: code });
  expect(res.headers.get('location')).toBe('/account?invited=30');
  expect(await q.creditBalance(userId)).toBe(30);
  expect(await q.creditBalance(inviter.id)).toBe(30);

  // A second invite for the same person is refused and pays nobody.
  const other = await oldUser('bob@acme.com');
  const second = await inviteFrom(other);
  const again = await credits.acceptInvite(second.code, { id: userId, email: 'grace@other.org' });
  expect(again.invite).toMatchObject({ ok: false, reason: 'already_invited' });
  expect(await q.creditBalance(other.id)).toBe(0);
  expect(await q.creditBalance(userId)).toBe(30);
});

test('an invite used by an existing account spends nothing', async () => {
  const inviter = await oldUser('ada@acme.com');
  const existing = await oldUser('grace@other.org');
  const { code } = await inviteFrom(inviter);
  const { res } = await signInThroughLink('grace@other.org', { inviteCode: code });
  expect(res.headers.get('location')).toBe('/account');
  expect(await q.creditBalance(existing.id)).toBe(0);
  expect((await credits.inviteSummary(inviter.id, 'https://bg0ne.com')).invites[0].used).toBe(
    false,
  );
});

test('no bonus for the same mailbox, a throwaway address or a brand-new inviter', async () => {
  const ada = await oldUser('ada.lovelace@gmail.com');
  const self = await inviteFrom(ada);
  const { userId: alias } = await signInThroughLink('adalovelace+2@gmail.com', {
    inviteCode: self.code,
  });
  expect(await q.creditBalance(alias)).toBe(0);
  expect(await q.creditBalance(ada.id)).toBe(0);

  const throwaway = await inviteFrom(ada);
  const { userId: burner } = await signInThroughLink('x@mailinator.com', {
    inviteCode: throwaway.code,
  });
  expect(await q.creditBalance(burner)).toBe(0);

  const fresh = await q.findOrCreateUser('new@acme.com');
  const early = await inviteFrom(fresh);
  const { userId: friend } = await signInThroughLink('friend@other.org', {
    inviteCode: early.code,
  });
  expect(await q.creditBalance(friend)).toBe(0);

  const statuses = (await sql`select status from invite_bonuses order by created_at`).map(
    (r) => r.status,
  );
  expect(statuses).toEqual(
    expect.arrayContaining(['same_mailbox', 'throwaway_address', 'inviter_too_new']),
  );
  expect(statuses).not.toContain('granted');
});

test('three invites each, then a 409', async () => {
  const user = await oldUser('ada@acme.com');
  const cookie = await sessionFor(user);
  for (let i = 0; i < 3; i += 1) {
    const res = await app.request('/api/v1/invites', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ note: `n${i}` }),
    });
    expect(res.status).toBe(201);
  }
  const over = await app.request('/api/v1/invites', { method: 'POST', headers: { cookie } });
  expect(over.status).toBe(409);
  const page = await (await app.request('/invites', { headers: { cookie } })).text();
  expect(page).toContain('<strong>0</strong> of 3 invites left');
});

test('?ref= is first touch and recorded only for an account the link creates', async () => {
  const ada = await oldUser('ada@acme.com');
  const { affiliate_code: ref } = await credits.inviteSummary(ada.id, 'https://bg0ne.com');
  const visit = await app.request(`/pricing?ref=${ref}`);
  expect(visit.headers.get('set-cookie')).toContain(`referral_code=${ref}`);

  const form = new FormData();
  form.set('email', 'erin@other.org');
  await app.request('/auth/link', {
    method: 'POST',
    body: form,
    headers: { cookie: `referral_code=${ref}` },
  });
  const [token] = await sql`select ref_code from login_tokens where email = 'erin@other.org'`;
  expect(token.ref_code).toBe(ref);

  const { userId } = await signInThroughLink('erin@other.org', { refCode: ref });
  const [row] =
    await sql`select affiliate_id from aff_attributions where user_id = ${String(userId)}`;
  expect(row.affiliate_id).toBe(String(ada.id));
});

test('a bad invite link is a 404 with the signup form, never a 402', async () => {
  const res = await app.request('/i/not-a-code');
  expect(res.status).toBe(404);
  expect(await res.text()).toContain('That invite link is not valid');
});
