import { sql } from './index.js';

/**
 * Bun's SQL tagged template does not infer a Postgres array from a JS array -- it
 * serialises it as `a,b`, which Postgres rejects for text[]. Build the literal.
 */
function pgArray(values) {
  if (!values?.length) return '{}';
  return `{${values.map((v) => `"${String(v).replace(/(["\\])/g, '\\$1')}"`).join(',')}}`;
}

/* ------------------------------------------------------------------ people -- */

export async function findOrCreateUser(email) {
  const [row] = await sql`
    insert into users ${sql({ email })}
    on conflict (email) do update set last_seen_at = now()
    returning *, email::text as email, (xmax = 0) as created
  `;
  return row;
}

export async function insertLoginToken({ tokenHash, email, expiresAt }) {
  await sql`
    insert into login_tokens ${sql({ token_hash: tokenHash, email, expires_at: expiresAt })}
  `;
}

export async function consumeLoginToken(tokenHash) {
  const [row] = await sql`
    update login_tokens set consumed_at = now()
    where token_hash = ${tokenHash} and consumed_at is null and expires_at > now()
    returning email
  `;
  return row?.email ?? null;
}

export async function startSession({ userId, ttlDays, userAgent }) {
  const [row] = await sql`
    insert into sessions ${sql({
      user_id: userId,
      expires_at: new Date(Date.now() + ttlDays * 86_400_000),
      user_agent: userAgent ?? null,
    })}
    returning id
  `;
  return row.id;
}

export async function getSessionUser(sessionId) {
  // Cast rather than interpolate: a cookie is attacker-supplied and an invalid uuid
  // should be a miss, not a 500 from the driver.
  if (!/^[0-9a-f-]{36}$/i.test(String(sessionId))) return null;
  const [row] = await sql`
    select u.*, u.email::text as email
    from sessions s join users u on u.id = s.user_id
    where s.id = ${sessionId}::uuid and s.expires_at > now()
  `;
  return row ?? null;
}

export async function endSession(sessionId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(sessionId))) return;
  await sql`delete from sessions where id = ${sessionId}::uuid`;
}

/* ----------------------------------------------------------------- passkeys -- */

export async function insertPasskey({ credentialId, userId, publicKey, counter, transports }) {
  await sql`
    insert into passkeys ${sql({
      credential_id: credentialId,
      user_id: userId,
      public_key: publicKey,
      counter,
    })}
  `;
  // Separate statement so the array literal can be cast explicitly. See pgArray.
  await sql`
    update passkeys set transports = ${pgArray(transports)}::text[]
    where credential_id = ${credentialId}
  `;
}

export async function getPasskey(credentialId) {
  const [row] = await sql`select * from passkeys where credential_id = ${credentialId}`;
  return row ?? null;
}

export async function listPasskeys(userId) {
  return sql`
    select credential_id, created_at, last_used_at from passkeys
    where user_id = ${userId} order by created_at
  `;
}

export async function touchPasskey(credentialId, counter) {
  await sql`
    update passkeys set counter = ${counter}, last_used_at = now()
    where credential_id = ${credentialId}
  `;
}

/* ------------------------------------------------------------------ credits -- */

/** The balance is the sum of the ledger. There is no counter to drift. */
export async function creditBalance(userId, tx = sql) {
  if (!userId) return 0;
  const [row] = await tx`
    select coalesce(sum(delta), 0)::int as n from credit_ledger where user_id = ${userId}
  `;
  return row?.n ?? 0;
}

export async function creditHistory(userId, limit = 50) {
  return sql`
    select id, delta, reason, created_at from credit_ledger
    where user_id = ${userId} order by id desc limit ${limit}
  `;
}

/**
 * Grant credits for a settled payment, inside the webhook's transaction.
 *
 * `on conflict do nothing` against the one-grant-per-payment index is what makes a
 * retried webhook free. CoinPay retries until it gets a 2xx, so this WILL be called
 * more than once for the same money and must pay out exactly once.
 */
export async function grantCredits(tx, { userId, credits, paymentId, reason = 'topup' }) {
  if (!userId || !Number.isFinite(credits) || credits <= 0) throw new Error('bad grant');
  const [row] = await tx`
    insert into credit_ledger ${tx({
      user_id: userId,
      delta: credits,
      reason,
      payment_id: paymentId ?? null,
    })}
    on conflict (payment_id) where payment_id is not null do nothing
    returning id
  `;
  // No row means this payment had already been granted. That is a success, not a fault.
  return { granted: Boolean(row), creditLedgerId: row?.id ?? null };
}

/**
 * Spend credits, or refuse.
 *
 * The `for update` on the user row is the whole point. Without it, two cutouts
 * submitted at the same moment both read a balance of one, both pass the check and
 * both insert a debit -- and the account finishes at minus one, having been given
 * work it did not pay for. Locking the user serialises every spend for that account
 * and leaves spends by other people completely unblocked.
 *
 * Returns null when the balance is short, so the caller can offer a top-up rather
 * than failing the request.
 */
export async function spendCredits({ userId, cost, reason, cutoutId = null }) {
  if (!userId || !Number.isFinite(cost) || cost <= 0) throw new Error('bad spend');
  return sql.begin(async (tx) => {
    await tx`select id from users where id = ${userId} for update`;
    const balance = await creditBalance(userId, tx);
    if (balance < cost) return null;
    const [row] = await tx`
      insert into credit_ledger ${tx({
        user_id: userId,
        delta: -cost,
        reason,
        cutout_id: cutoutId,
      })}
      returning id
    `;
    return { spent: cost, remaining: balance - cost, ledgerId: row.id };
  });
}

/**
 * Give a credit back.
 *
 * A spend happens BEFORE the work, because that is the only ordering that stops two
 * concurrent requests spending the same last credit. The cost of that ordering is
 * that a failure has to be refunded explicitly, and this is it. Deliberately a fresh
 * positive row rather than a delete: the ledger is the record of what happened, and
 * what happened is that somebody was charged and then made whole.
 */
export async function refundCredits({ userId, credits, reason = 'refund' }) {
  if (!userId || !Number.isFinite(credits) || credits <= 0) throw new Error('bad refund');
  const [row] = await sql`
    insert into credit_ledger ${sql({ user_id: userId, delta: credits, reason })}
    returning id
  `;
  return row.id;
}

export async function userEmail(userId) {
  if (!userId) return null;
  const [row] = await sql`select email::text as email from users where id = ${userId}`;
  return row?.email ?? null;
}

/* ------------------------------------------------------------------ cutouts -- */

export async function recordCutout(row) {
  const [out] = await sql`
    insert into cutouts ${sql({
      user_id: row.userId ?? null,
      api_key_id: row.apiKeyId ?? null,
      tier: row.tier,
      model: row.model,
      width: row.width ?? null,
      height: row.height ?? null,
      bytes_in: row.bytesIn ?? null,
      bytes_out: row.bytesOut ?? null,
      duration_ms: row.durationMs ?? null,
      status: row.status ?? 'ok',
      payer: row.payer ?? null,
    })}
    returning id
  `;
  return out.id;
}

export async function recentCutouts(userId, limit = 25) {
  return sql`
    select id, tier, model, width, height, duration_ms, created_at from cutouts
    where user_id = ${userId} order by created_at desc limit ${limit}
  `;
}

/* ------------------------------------------------------------------- shares -- */

/**
 * Keep a result so it has a URL.
 *
 * Returns null rather than throwing when the image is too big to be worth keeping:
 * a share link is a nicety, and failing somebody's cutout because we did not want
 * to store the result would be trading the product for the garnish.
 */
export async function createShare({
  cutoutId,
  userId,
  png,
  width,
  height,
  tier,
  model,
  ttlDays = 7,
  maxBytes = 8 * 1024 * 1024,
}) {
  if (!png || png.byteLength === 0) return null;
  if (png.byteLength > maxBytes) return null;

  const [row] = await sql`
    insert into shares ${sql({
      cutout_id: cutoutId ?? null,
      user_id: userId ?? null,
      png: Buffer.from(png),
      width: width ?? null,
      height: height ?? null,
      tier: tier ?? null,
      model: model ?? null,
      expires_at: new Date(Date.now() + ttlDays * 86_400_000),
    })}
    returning id, expires_at
  `;
  return row;
}

/** A share, if it exists and has not expired. Expiry is enforced in the query so a
 *  missed cleanup run can never serve an image past its date. */
export async function getShare(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const [row] = await sql`
    select * from shares where id = ${id}::uuid and expires_at > now()
  `;
  return row ?? null;
}

/** The same, without the bytes -- for a page that only needs to describe it. */
export async function getShareMeta(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const [row] = await sql`
    select id, width, height, tier, model, created_at, expires_at, octet_length(png) as bytes
    from shares where id = ${id}::uuid and expires_at > now()
  `;
  return row ?? null;
}

/**
 * One person's history: every cutout they have run, with its share if the image is
 * still around.
 *
 * Driven from `cutouts` rather than from `shares` so an expired image still appears
 * as something that happened and was charged for, instead of vanishing from the
 * record along with its bytes.
 */
export async function cutoutHistory(userId, limit = 60) {
  if (!userId) return [];
  return sql`
    select c.id, c.tier, c.model, c.width, c.height, c.duration_ms, c.created_at,
           s.id as share_id, s.expires_at as share_expires_at
    from cutouts c
    left join shares s on s.cutout_id = c.id and s.expires_at > now()
    where c.user_id = ${userId}
    order by c.created_at desc
    limit ${limit}
  `;
}

export async function deleteShare({ id, userId }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return false;
  const rows = await sql`
    delete from shares where id = ${id}::uuid and user_id = ${userId} returning id
  `;
  return rows.length > 0;
}

/** Drop what has expired. Cheap, indexed, and safe to run on every instance. */
export async function purgeExpiredShares() {
  const rows = await sql`delete from shares where expires_at <= now() returning id`;
  return rows.length;
}

/* ----------------------------------------------------------------- api keys -- */

export async function insertApiKey({ userId, name, keyHash, prefix }) {
  const [row] = await sql`
    insert into api_keys ${sql({ user_id: userId, name, key_hash: keyHash, prefix })}
    returning id, prefix, created_at
  `;
  return row;
}

export async function userForApiKey(keyHash) {
  const [row] = await sql`
    select u.*, u.email::text as email, k.id as api_key_id
    from api_keys k join users u on u.id = k.user_id
    where k.key_hash = ${keyHash} and k.revoked_at is null
  `;
  if (row) {
    // Fire and forget: a last-used timestamp is not worth failing a request over.
    sql`update api_keys set last_used_at = now() where id = ${row.api_key_id}`.catch(() => {});
  }
  return row ?? null;
}

export async function listApiKeys(userId) {
  return sql`
    select id, name, prefix, created_at, last_used_at from api_keys
    where user_id = ${userId} and revoked_at is null order by created_at
  `;
}

export async function revokeApiKey({ userId, id }) {
  await sql`update api_keys set revoked_at = now() where id = ${id} and user_id = ${userId}`;
}

/* ------------------------------------------------------------------ payments -- */

export async function paymentByRef(ref) {
  const [row] = await sql`
    select * from payments where provider = 'coinpay' and provider_ref = ${ref}
  `;
  return row ?? null;
}
