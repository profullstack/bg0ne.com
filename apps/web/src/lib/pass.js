/**
 * Profullstack Pass (https://coinpayportal.com/pass): a CoinPay user who
 * deposited $99 into their own CoinPay wallet gets a free month on every
 * Profullstack property. CoinPay sends it as the userinfo claim
 * `pass: { active, expires_at }`, seen here only at sign-in (coinpay-onboard
 * 0.5.0 finishSignIn returns it parsed as `{ active, expiresAt }`).
 *
 * bg0ne is pay-as-you-go, so the pass is free credits: the smallest top-up
 * bundle, once per pass, keyed on `coinpay-pass:<coinpay sub>:<expires_at>`
 * through the same (user, source) ledger path credit codes use.
 */
import { config } from '@bg0ne/config';

export const PASS_URL = 'https://coinpayportal.com/pass';

/** The smallest top-up bundle's credits. */
export function passCredits(topups = config.pricing.topups) {
  const smallest = [...topups].sort((a, b) => a.cents - b.cents)[0];
  return smallest ? smallest.credits : 0;
}

/** What an active pass grants, or null. Pure. */
export function passGrant({ sub, pass, now = new Date(), topups } = {}) {
  const exp = pass?.expiresAt instanceof Date ? pass.expiresAt : null;
  if (!sub || pass?.active !== true || !exp || exp.getTime() <= now.getTime()) return null;
  const credits = passCredits(topups);
  if (!(credits > 0)) return null;
  return { credits, source: `coinpay-pass:${sub}:${exp.toISOString()}` };
}

/** Grant it, once per pass. `q` is @bg0ne/db/queries. */
export async function grantCoinpayPass(q, { userId, sub, pass }) {
  const g = passGrant({ sub, pass });
  if (!userId || !g) return null;
  return q.grantFromSource({
    userId,
    credits: g.credits,
    source: g.source,
    reason: 'Profullstack Pass',
  });
}
