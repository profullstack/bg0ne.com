import { beforeAll, beforeEach, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { config } from '../packages/config/src/index.js';
import { sql } from '../packages/db/src/index.js';
import * as q from '../packages/db/src/queries.js';
import { configurePayments, readWebhook } from '../packages/payments/src/index.js';

/**
 * The CoinPay webhook, end to end: signed body in, credits out.
 *
 * Driven through the real route rather than through settleWebhook alone, because
 * the bug this exists for lived in the gap between them -- the payments file read
 * the envelope flat, and so did the receipt lookup in the route. Every payload here
 * is the NESTED shape CoinPay actually signs (src/lib/webhooks/service.ts in
 * coinpayportal); the body below is the real payment.forwarded that sat in
 * CoinPay's retry queue answering 500, with only the ids swapped.
 *
 * No afterAll(close): the pool is shared by every test file in the process.
 */

const SECRET = 'whsec_webhook_test';
let app;
let user;

beforeAll(async () => {
  process.env.COINPAY_WEBHOOK_SECRET = SECRET;
  configurePayments({ sql, coinpay: config.coinpay, siteUrl: 'https://example.test' });
  ({ app } = await import('../apps/web/src/app.js'));
});

beforeEach(async () => {
  await sql`truncate credit_ledger, cutouts, payments, sessions, api_keys, users restart identity cascade`;
  user = await q.findOrCreateUser(`hook-${crypto.randomUUID()}@example.com`);
});

async function checkout(amountCents = 500, ref = crypto.randomUUID()) {
  await sql`
    insert into payments ${sql({
      user_id: user.id,
      provider: 'coinpay',
      provider_ref: ref,
      amount_cents: amountCents,
      currency: 'USD',
      status: 'pending',
    })}
  `;
  return ref;
}

/** The envelope CoinPay sends. The top-level id is the EVENT, never the payment. */
function nested(paymentId, status, { userId = user.id, credits = '200' } = {}) {
  return {
    id: `evt_${paymentId}_${Math.floor(Date.now() / 1000)}`,
    type: `payment.${status}`,
    data: {
      payment_id: paymentId,
      status,
      amount: '5',
      amount_usd: '5',
      amount_crypto: '5.0910182',
      currency: 'USDC_ETH',
      tx_hash: '0xa86f766603afeb517f65e59d8707c8cd1d1b06c50a4210557675812efdaebd02',
      metadata: {
        credits,
        user_id: userId,
        description: `${credits} bg0ne credits`,
        total_amount: 5.09,
        wallet_source: 'business',
        network_fee_usd: 0.09,
        total_amount_usd: 5.09,
        network_fee_amount: 0.09,
        total_amount_currency: 'USD',
      },
    },
    created_at: new Date().toISOString(),
    business_id: '53d61299-0899-4ef5-bdbb-fd5960cd7422',
  };
}

function deliver(body, { secret = SECRET, t = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(body);
  const v1 = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  return app.fetch(
    new Request('http://localhost/webhooks/coinpay', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-coinpay-signature': `t=${t},v1=${v1}` },
      body: raw,
    }),
  );
}

async function ledger(paymentRef) {
  return sql`
    select l.delta from credit_ledger l join payments p on p.id = l.payment_id
    where p.provider_ref = ${paymentRef}
  `;
}

test('the reference is the payment id, not the event id', () => {
  const body = nested('pay_1', 'confirmed');
  const { ref, status, meta, event } = readWebhook(body);
  expect(ref).toBe('pay_1');
  expect(ref).not.toBe(body.id);
  expect(status).toBe('confirmed');
  expect(meta.user_id).toBe(user.id);
  expect(event).toBe('payment.confirmed');
});

test('a nested payment.confirmed credits the buyer', async () => {
  const ref = await checkout(500);
  const res = await deliver(nested(ref, 'confirmed'));
  expect(res.status).toBe(200);
  expect((await res.json()).granted).toBe(true);
  expect(await q.creditBalance(user.id)).toBe(200);
});

test('a nested payment.forwarded on its own credits the buyer', async () => {
  // The case that was live: confirmed had failed, forwarded is what CoinPay retries.
  const ref = await checkout(500);
  const res = await deliver(nested(ref, 'forwarded'));
  expect(res.status).toBe(200);
  expect(await q.creditBalance(user.id)).toBe(200);
});

test('confirmed, forwarded and their retries credit exactly once', async () => {
  const ref = await checkout(500);
  for (const status of ['confirmed', 'confirmed', 'forwarded', 'forwarded', 'confirmed']) {
    const res = await deliver(nested(ref, status));
    expect(res.status).toBe(200);
  }
  expect(await ledger(ref)).toEqual([{ delta: 200 }]);
  expect(await q.creditBalance(user.id)).toBe(200);
});

test('credits follow what we charged, not what the payload says', async () => {
  const ref = await checkout(500);
  await deliver(nested(ref, 'forwarded', { credits: '6000' }));
  expect(await q.creditBalance(user.id)).toBe(200);
});

test('a nested pending or expired payment grants nothing', async () => {
  const ref = await checkout(500);
  for (const status of ['pending', 'expired', 'failed']) {
    const res = await deliver(nested(ref, status));
    expect(res.status).toBe(200);
  }
  expect(await q.creditBalance(user.id)).toBe(0);
});

test('a payment we never checked out grants nothing and does not 500', async () => {
  const res = await deliver(nested(crypto.randomUUID(), 'confirmed'));
  expect(res.status).toBe(200);
  expect((await res.json()).granted).toBe(false);
  expect(await q.creditBalance(user.id)).toBe(0);
});

test('signature checks are unchanged: wrong secret and stale timestamp are refused', async () => {
  const ref = await checkout(500);
  expect((await deliver(nested(ref, 'confirmed'), { secret: 'whsec_wrong' })).status).toBe(401);
  const stale = Math.floor(Date.now() / 1000) - 301;
  expect((await deliver(nested(ref, 'confirmed'), { t: stale })).status).toBe(401);
  expect(await q.creditBalance(user.id)).toBe(0);
});
