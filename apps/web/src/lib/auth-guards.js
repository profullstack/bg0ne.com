import { matchesAny } from '@profullstack/throttle';

/**
 * Brute-force guards on every sign-in route.
 *
 * Throttle 0.5.0 treats a `credential: false` rule as a guard: over its limit is
 * always a plain 429, never a 402 offer, counted per address only, and neither a
 * paid pass nor a welcomed crawler skips it. Without these rules the sign-in
 * routes fell under the general allowance, which IS sold: a 1 USD pass then
 * bought unlimited magic-link and OAuth-callback guesses.
 *
 * The numbers are as written (guards are never multiplied by headroom): ten a
 * minute per address is plenty for a person and nothing for a guesser.
 *
 *   /auth/                   magic-link request + redemption, passkeys, sign-out
 *   /api/v1/coinpay/oauth/   CoinPay OAuth start + callback
 *
 * /signin and /signup are only the forms (GET, no secret checked) and stay
 * under the general allowance.
 */
export const AUTH_GUARD_RULES = [
  { path: '/auth/', limit: 10, credential: false },
  { path: '/api/v1/coinpay/oauth/', limit: 10, credential: false },
];

const GUARD_PATHS = AUTH_GUARD_RULES.map((rule) => rule.path);

/**
 * Whether a request is on a guarded sign-in route.
 *
 * The throttle runs `exempt` BEFORE it looks at rules, and this site's exempt is
 * "the session cookie's name appears in Cookie", which any client can write. So
 * the exemption must never apply here, or `Cookie: <name>=x` skips the guard.
 */
export const isAuthRoute = (request) => matchesAny(GUARD_PATHS, new URL(request.url).pathname);
