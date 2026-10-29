import { beforeAll, beforeEach, expect, test } from 'bun:test';
import * as auth from '../../../packages/auth/src/index.js';
import { sql } from '../../../packages/db/src/index.js';
import * as q from '../../../packages/db/src/queries.js';

/**
 * Sign in with CoinPay. The STANDING rule under test: an account binds to the CoinPay
 * `sub`, never to the (unverified) email CoinPay reports; linking needs a session; a
 * callback whose state or nonce is wrong is refused.
 */

process.env.COINPAY_OAUTH_CLIENT_ID = 'cp_test_client';
process.env.COINPAY_OAUTH_CLIENT_SECRET = 'test-client-secret-value';

const ISSUER = 'https://coinpayportal.com';
let app;

beforeAll(async () => {
  ({ app } = await import('../src/app.js'));
});

beforeEach(async () => {
  await sql`truncate coinpay_oauth_pending, coinpay_identities, user_profiles, login_tokens, sessions, users restart identity cascade`;
});

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(claims)}.sig`;

/** A stand-in for CoinPay's token + userinfo endpoints. */
function fakeCoinpay({ sub, email, nonce, aud = 'cp_test_client', userinfoSub = sub }) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, body: init?.body ? String(init.body) : null });
    if (u.pathname === '/api/oauth/token') {
      return Response.json({
        access_token: 'at',
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: jwt({
          iss: ISSUER,
          aud,
          sub,
          nonce,
          exp: Math.floor(Date.now() / 1000) + 600,
          email,
        }),
      });
    }
    if (u.pathname === '/api/oauth/userinfo') {
      return Response.json({ sub: userinfoSub, email, email_verified: false });
    }
    return new Response('nope', { status: 404 });
  };
  return { fetch, calls };
}

async function pendingFor(state) {
  const [row] = await sql`select * from coinpay_oauth_pending where state = ${state}`;
  return row;
}

test('start redirects to CoinPay with PKCE S256, state and nonce, and sets the state cookie', async () => {
  const res = await app.request('/api/v1/coinpay/oauth/start');
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get('location'));
  expect(loc.origin + loc.pathname).toBe(`${ISSUER}/api/oauth/authorize`);
  expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
  expect(loc.searchParams.get('code_challenge')).toBeTruthy();
  expect(loc.searchParams.get('nonce')).toBeTruthy();
  expect(loc.searchParams.get('scope')).toBe('openid profile email');
  expect(loc.searchParams.get('redirect_uri')).toEndWith('/api/v1/coinpay/oauth/callback');
  const state = loc.searchParams.get('state');
  expect(res.headers.get('set-cookie')).toContain(`${auth.COINPAY_STATE_COOKIE}=${state}`);
  const row = await pendingFor(state);
  expect(row.mode).toBe('signin');
  expect(row.nonce).toBe(loc.searchParams.get('nonce'));
});

test('the sign-in page offers CoinPay first', async () => {
  for (const path of ['/signin', '/signup']) {
    const html = await (await app.request(path)).text();
    const cp = html.indexOf('Sign in with CoinPay');
    expect(cp).toBeGreaterThan(-1);
    expect(cp).toBeLessThan(html.indexOf('action="/auth/link"'));
  }
});

test('a callback with a forged state is refused', async () => {
  const start = await app.request('/api/v1/coinpay/oauth/start');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const res = await app.request(`/api/v1/coinpay/oauth/callback?state=forged&code=x`, {
    headers: { cookie: `${auth.COINPAY_STATE_COOKIE}=${state}` },
  });
  expect(res.status).toBe(400);
  expect(res.headers.get('set-cookie') ?? '').not.toContain('bg0ne_session=');
  // No cookie at all: refused too, even with the real state.
  const res2 = await app.request(`/api/v1/coinpay/oauth/callback?state=${state}&code=x`);
  expect(res2.status).toBe(400);
});

test('a wrong nonce in the id_token is refused and the request is spent', async () => {
  const { state } = await auth.startCoinpay();
  const { fetch } = fakeCoinpay({ sub: 'sub-1', email: 'a@b.co', nonce: 'not-the-nonce' });
  await expect(
    auth.finishCoinpay({ state, code: 'c', cookieState: state, sessionUser: null, fetch }),
  ).rejects.toMatchObject({ code: 'exchange_failed' });
  // Single use: the same state cannot be tried again.
  expect(await pendingFor(state)).toBeUndefined();
});

test('the code exchange sends the client secret and the PKCE verifier', async () => {
  const { state } = await auth.startCoinpay();
  const { nonce, verifier } = await pendingFor(state);
  const { fetch, calls } = fakeCoinpay({ sub: 'sub-2', email: 'x@y.co', nonce });
  await auth.finishCoinpay({ state, code: 'c', cookieState: state, sessionUser: null, fetch });
  const body = new URLSearchParams(calls.find((c) => c.path === '/api/oauth/token').body);
  expect(body.get('client_secret')).toBe('test-client-secret-value');
  expect(body.get('code_verifier')).toBe(verifier);
});

test("a CoinPay login carrying an existing user's email does NOT get that account", async () => {
  const victim = await q.findOrCreateUser('victim@acme.com');
  const { state } = await auth.startCoinpay();
  const { nonce } = await pendingFor(state);
  const { fetch } = fakeCoinpay({ sub: 'attacker-sub', email: 'victim@acme.com', nonce });
  const out = await auth.finishCoinpay({
    state,
    code: 'c',
    cookieState: state,
    sessionUser: null,
    fetch,
  });
  expect(out.created).toBe(true);
  expect(out.user.id).not.toBe(victim.id);
  expect(out.user.email).toBe(auth.placeholderEmail('attacker-sub'));
  const identity = await q.coinpayIdentityBySub('attacker-sub');
  expect(identity.user_id).toBe(out.user.id);
  // And the same sub signs back in to the same (new) account.
  const again = await auth.startCoinpay();
  const p2 = await pendingFor(again.state);
  const out2 = await auth.finishCoinpay({
    state: again.state,
    code: 'c',
    cookieState: again.state,
    sessionUser: null,
    fetch: fakeCoinpay({ sub: 'attacker-sub', email: 'victim@acme.com', nonce: p2.nonce }).fetch,
  });
  expect(out2.created).toBe(false);
  expect(out2.user.id).toBe(out.user.id);
});

test('userinfo must name the same sub as the id_token', async () => {
  const { state } = await auth.startCoinpay();
  const { nonce } = await pendingFor(state);
  const { fetch } = fakeCoinpay({ sub: 'sub-a', userinfoSub: 'sub-b', email: 'a@b.co', nonce });
  await expect(
    auth.finishCoinpay({ state, code: 'c', cookieState: state, sessionUser: null, fetch }),
  ).rejects.toMatchObject({ code: 'exchange_failed' });
});

test('linking needs a session, and only the account that started it', async () => {
  // Starting a link signed out bounces to sign-in and creates nothing.
  const res = await app.request('/api/v1/coinpay/oauth/start?mode=link');
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('/signin');
  const [{ n }] = await sql`select count(*)::int as n from coinpay_oauth_pending`;
  expect(n).toBe(0);

  const owner = await q.findOrCreateUser('owner@acme.com');
  const other = await q.findOrCreateUser('other@acme.com');
  const { state } = await auth.startCoinpay({ mode: 'link', userId: owner.id });
  const { nonce } = await pendingFor(state);
  // Finished by somebody else's session: refused.
  await expect(
    auth.finishCoinpay({
      state,
      code: 'c',
      cookieState: state,
      sessionUser: other,
      fetch: fakeCoinpay({ sub: 'link-sub', email: 'z@z.co', nonce }).fetch,
    }),
  ).rejects.toMatchObject({ code: 'not_signed_in' });
  expect(await q.coinpayIdentityBySub('link-sub')).toBeNull();

  const again = await auth.startCoinpay({ mode: 'link', userId: owner.id });
  const p2 = await pendingFor(again.state);
  const out = await auth.finishCoinpay({
    state: again.state,
    code: 'c',
    cookieState: again.state,
    sessionUser: owner,
    fetch: fakeCoinpay({ sub: 'link-sub', email: 'z@z.co', nonce: p2.nonce }).fetch,
  });
  expect(out.mode).toBe('link');
  expect((await q.coinpayIdentityBySub('link-sub')).user_id).toBe(owner.id);
  // A real email means another way in, so CoinPay may be disconnected.
  expect(await auth.canDisconnectCoinpay(owner)).toBe(true);
});

test('a CoinPay-only account cannot disconnect its only way in', async () => {
  const user = await q.createUserForCoinpay({
    sub: 'only-sub',
    email: 'c@d.co',
    placeholder: auth.placeholderEmail('only-sub'),
  });
  expect(await auth.canDisconnectCoinpay(user)).toBe(false);
  const sessionId = await q.startSession({ userId: user.id, ttlDays: 1 });
  const res = await app.request('/account/coinpay/disconnect', {
    method: 'POST',
    headers: { cookie: `bg0ne_session=${sessionId}` },
  });
  expect(res.headers.get('location')).toContain('coinpay=only_way_in');
  expect(await q.coinpayIdentityBySub('only-sub')).not.toBeNull();
});

test('a placeholder address cannot be sent a magic link', async () => {
  const form = new FormData();
  form.set('email', auth.placeholderEmail('only-sub'));
  await app.request('/auth/link', { method: 'POST', body: form });
  const [{ n }] = await sql`select count(*)::int as n from login_tokens`;
  expect(n).toBe(0);
});
