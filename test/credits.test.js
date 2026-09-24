import { afterAll, beforeEach, expect, test } from 'bun:test';
import { close, sql } from '../packages/db/src/index.js';
import * as q from '../packages/db/src/queries.js';

/**
 * The money tests.
 *
 * These are the ones worth having. Everything else here is a form post; this is the
 * part where being wrong means charging somebody twice or giving work away.
 */

let user;

beforeEach(async () => {
  await sql`truncate credit_ledger, cutouts, payments, sessions, api_keys, users restart identity cascade`;
  user = await q.findOrCreateUser(`test-${crypto.randomUUID()}@example.com`);
});

afterAll(async () => {
  await close();
});

async function makePayment(amountCents, ref = crypto.randomUUID()) {
  const [row] = await sql`
    insert into payments ${sql({
      user_id: user.id,
      provider: 'coinpay',
      provider_ref: ref,
      amount_cents: amountCents,
      currency: 'USD',
      status: 'paid',
    })}
    returning *
  `;
  return row;
}

test('a new account has no credits', async () => {
  expect(await q.creditBalance(user.id)).toBe(0);
});

test('a settled payment grants credits once, however many times it is replayed', async () => {
  const payment = await makePayment(500);

  // CoinPay retries until it gets a 2xx, so this is not a hypothetical.
  const first = await sql.begin((tx) =>
    q.grantCredits(tx, { userId: user.id, credits: 200, paymentId: payment.id }),
  );
  const second = await sql.begin((tx) =>
    q.grantCredits(tx, { userId: user.id, credits: 200, paymentId: payment.id }),
  );
  const third = await sql.begin((tx) =>
    q.grantCredits(tx, { userId: user.id, credits: 200, paymentId: payment.id }),
  );

  expect(first.granted).toBe(true);
  expect(second.granted).toBe(false);
  expect(third.granted).toBe(false);
  expect(await q.creditBalance(user.id)).toBe(200);
});

test('two different payments both grant', async () => {
  const a = await makePayment(500);
  const b = await makePayment(2000);
  await sql.begin((tx) => q.grantCredits(tx, { userId: user.id, credits: 200, paymentId: a.id }));
  await sql.begin((tx) => q.grantCredits(tx, { userId: user.id, credits: 1000, paymentId: b.id }));
  expect(await q.creditBalance(user.id)).toBe(1200);
});

test('spending refuses when the balance is short, and writes nothing', async () => {
  const payment = await makePayment(500);
  await sql.begin((tx) => q.grantCredits(tx, { userId: user.id, credits: 2, paymentId: payment.id }));

  expect(await q.spendCredits({ userId: user.id, cost: 1, reason: 'cutout' })).toBeTruthy();
  expect(await q.spendCredits({ userId: user.id, cost: 1, reason: 'cutout' })).toBeTruthy();

  // Third one has nothing left to take.
  expect(await q.spendCredits({ userId: user.id, cost: 1, reason: 'cutout' })).toBeNull();
  expect(await q.creditBalance(user.id)).toBe(0);
});

/**
 * The one that matters.
 *
 * Without `select ... for update` on the user row, twenty concurrent cutouts all read
 * the same balance, all pass the check, and all insert a debit -- leaving the account
 * deep in the negative having been given work nobody paid for. This asserts the
 * balance can never go below zero no matter how they interleave.
 */
test('concurrent spends cannot oversell the last credits', async () => {
  const payment = await makePayment(500);
  await sql.begin((tx) => q.grantCredits(tx, { userId: user.id, credits: 5, paymentId: payment.id }));

  const attempts = await Promise.all(
    Array.from({ length: 20 }, () =>
      q.spendCredits({ userId: user.id, cost: 1, reason: 'cutout' }).catch(() => null),
    ),
  );

  const succeeded = attempts.filter(Boolean).length;
  expect(succeeded).toBe(5);
  expect(await q.creditBalance(user.id)).toBe(0);
});

test('a refund puts back exactly what the failed cutout took', async () => {
  const payment = await makePayment(500);
  await sql.begin((tx) => q.grantCredits(tx, { userId: user.id, credits: 3, paymentId: payment.id }));

  const spend = await q.spendCredits({ userId: user.id, cost: 1, reason: 'cutout' });
  expect(await q.creditBalance(user.id)).toBe(2);

  await q.refundCredits({ userId: user.id, credits: spend.spent, reason: 'cutout failed' });
  expect(await q.creditBalance(user.id)).toBe(3);

  // And the ledger still shows what happened, rather than pretending it did not.
  const history = await q.creditHistory(user.id);
  expect(history.map((h) => h.reason)).toContain('cutout failed');
});

test('the ledger rejects a zero-delta row', async () => {
  // Awaited deliberately: an unawaited `.rejects` leaves a pending promise that the
  // test runner sits on forever, which reads as a hung suite rather than a bad test.
  await expect(
    sql`insert into credit_ledger ${sql({ user_id: user.id, delta: 0, reason: 'nonsense' })}`.then(
      (r) => r,
    ),
  ).rejects.toThrow();
});

test('an api key round-trips and its plaintext is never stored', async () => {
  const auth = await import('../packages/auth/src/index.js');
  const key = await auth.createApiKey({ userId: user.id, name: 'test' });
  expect(key.plaintext.startsWith('bg_live_')).toBe(true);

  const found = await auth.userFromApiKey(`Bearer ${key.plaintext}`);
  expect(found?.id).toBe(user.id);

  // The plaintext must not appear anywhere in the row we kept.
  const [row] = await sql`select * from api_keys where user_id = ${user.id}`;
  expect(JSON.stringify(row)).not.toContain(key.plaintext);

  expect(await auth.userFromApiKey('Bearer bg_live_wrong')).toBeNull();
});

test('a garbage session cookie is a miss, not a crash', async () => {
  expect(await q.getSessionUser('not-a-uuid')).toBeNull();
  expect(await q.getSessionUser("'; drop table users; --")).toBeNull();
});

test('a magic link works once', async () => {
  const auth = await import('../packages/auth/src/index.js');
  const email = `link-${crypto.randomUUID()}@example.com`;
  const url = await auth.createLoginLink(email);
  const token = new URL(url).searchParams.get('t');

  const first = await auth.consumeLoginLink(token);
  expect(first?.user?.email).toBe(email);

  // Replaying a consumed link must not mint a second session.
  expect(await auth.consumeLoginLink(token)).toBeNull();
});
