import { config } from '@bg0ne/config';
import * as q from '@bg0ne/db/queries';
import {
  authorizeUrl,
  finishSignIn,
  pkce,
  randomToken,
  SIGN_IN_SCOPES,
  sameState,
} from '@profullstack/coinpay-onboard/oauth';

/**
 * Sign in with CoinPay (@profullstack/coinpay-onboard): auth code + PKCE S256 + state +
 * nonce, as a confidential client.
 *
 * STANDING rule: the account is bound to the CoinPay `sub`. The email CoinPay reports
 * is unverified, so it never signs anybody in to an existing account, is never stored
 * as users.email, and grants nothing. Linking CoinPay to an existing account happens
 * only while signed in to it (mode "link").
 */

/** The cookie that ties the callback to the browser that started the request. */
export const COINPAY_STATE_COOKIE = 'bg0ne_coinpay_state';

/** Reserved TLD (RFC 2606): can never receive mail or collide with a real address. */
const PLACEHOLDER_DOMAIN = 'coinpay.invalid';

export const placeholderEmail = (sub) =>
  `cp-${String(sub)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 64)}@${PLACEHOLDER_DOMAIN}`;

/** True for the address a CoinPay-only account was given in place of a real one. */
export const isPlaceholderEmail = (email) =>
  String(email ?? '')
    .toLowerCase()
    .endsWith(`@${PLACEHOLDER_DOMAIN}`);

export const coinpayEnabled = () => config.coinpayOauth.enabled;

/**
 * Begin a request. Returns the CoinPay URL to send the browser to and the state for
 * the cookie. The PKCE verifier and nonce never leave the server.
 */
export async function startCoinpay({ mode = 'signin', userId = null, refCode } = {}) {
  if (mode === 'link' && !userId) throw new Error('linking CoinPay needs a signed-in account');
  const state = randomToken();
  const nonce = randomToken();
  const { verifier, challenge } = pkce();
  await q.insertCoinpayPending({
    state,
    verifier,
    nonce,
    mode,
    userId: mode === 'link' ? userId : null,
    refCode: refCode ?? null,
  });
  const url = authorizeUrl({
    clientId: config.coinpayOauth.clientId,
    redirectUri: config.coinpayOauth.redirectUri,
    state,
    challenge,
    nonce,
    scopes: SIGN_IN_SCOPES,
    base: config.coinpayOauth.base,
  });
  return { url, state };
}

export class CoinpayError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Finish a request.
 *
 * @param {{ state: string, code: string, cookieState: string, sessionUser: object|null,
 *           userAgent?: string, fetch?: typeof fetch }} input
 * @returns {Promise<{ mode: 'signin'|'link', user: object, sessionId?: string,
 *                     created: boolean, refCode?: string|null,
 *                     email: string|null, name: string|null }>}
 */
export async function finishCoinpay({ state, code, cookieState, sessionUser, userAgent, fetch }) {
  // The state must come back to the same browser that asked, and match exactly.
  if (!sameState(cookieState, state)) throw new CoinpayError('bad_state', 'state mismatch');
  const pending = await q.takeCoinpayPending(state);
  if (!pending) throw new CoinpayError('bad_state', 'unknown or expired request');
  if (!code) throw new CoinpayError('no_code', 'CoinPay returned no code');

  let result;
  try {
    result = await finishSignIn({
      code,
      verifier: pending.verifier,
      nonce: pending.nonce,
      clientId: config.coinpayOauth.clientId,
      clientSecret: config.coinpayOauth.clientSecret,
      redirectUri: config.coinpayOauth.redirectUri,
      base: config.coinpayOauth.base,
      fetch,
    });
  } catch (err) {
    throw new CoinpayError('exchange_failed', String(err?.message ?? err));
  }
  const { sub, email, name } = result;

  if (pending.mode === 'link') {
    // Only the account that started the link may finish it.
    if (!sessionUser || sessionUser.id !== pending.user_id) {
      throw new CoinpayError('not_signed_in', 'linking needs the same signed-in account');
    }
    const existing = await q.coinpayIdentityBySub(sub);
    if (existing && existing.user_id !== sessionUser.id) {
      throw new CoinpayError('sub_taken', 'that CoinPay account is linked to another account');
    }
    const mine = await q.coinpayIdentityForUser(sessionUser.id);
    if (mine && mine.sub !== sub) {
      throw new CoinpayError('already_linked', 'a different CoinPay account is already linked');
    }
    if (!existing) await q.linkCoinpayIdentity({ sub, userId: sessionUser.id, email, name });
    else await q.touchCoinpayIdentity(sub, { email, name });
    return { mode: 'link', user: sessionUser, created: false, email, name };
  }

  // Sign in: by sub, and only by sub.
  const identity = await q.coinpayIdentityBySub(sub);
  let user;
  let created = false;
  if (identity) {
    await q.touchCoinpayIdentity(sub, { email, name });
    user = await q.userById(identity.user_id);
    if (!user) throw new CoinpayError('no_account', 'linked account no longer exists');
  } else {
    user = await q.createUserForCoinpay({ sub, email, name, placeholder: placeholderEmail(sub) });
    created = true;
  }
  const sessionId = await q.startSession({
    userId: user.id,
    ttlDays: config.session.ttlDays,
    userAgent,
  });
  return {
    mode: 'signin',
    user,
    sessionId,
    created,
    refCode: pending.ref_code ?? null,
    email,
    name,
  };
}

/**
 * Whether CoinPay may be disconnected: only when the account has another way in (a
 * real email for magic links, or a passkey).
 */
export async function canDisconnectCoinpay(user) {
  if (!isPlaceholderEmail(user.email)) return true;
  return (await q.listPasskeys(user.id)).length > 0;
}
