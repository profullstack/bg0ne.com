import { expect, test } from 'bun:test';
import { config } from '../packages/config/src/index.js';

/**
 * Which chains a buyer may settle on.
 *
 * CoinPay resolves the payee from the BUSINESS's own wallets, so a chain the
 * business has no wallet for is refused with a 400 at the moment somebody presses
 * Buy. That is what shipped: the default was BASE, this business has no BASE
 * wallet, and every buy button on /pricing returned a bare 500. The key was valid
 * and the code was fine; the chain simply did not exist for us.
 */

/** Verified against GET /api/businesses/:id/wallets on 2026-09-24. */
const WALLETS_WE_HOLD = new Set([
  'ADA', 'BCH', 'BNB', 'BTC', 'DOGE', 'ETH', 'POL', 'SOL', 'XRP',
  'USDC_ETH', 'USDC_POL', 'USDC_SOL', 'USDT_ETH', 'USDT_POL', 'USDT_SOL',
]);

test('every offered chain is one we hold a wallet for', () => {
  expect(config.coinpay.chains.length).toBeGreaterThan(0);
  for (const chain of config.coinpay.chains) {
    expect(WALLETS_WE_HOLD.has(chain)).toBe(true);
  }
});

test('BASE is not offered, because we have no BASE wallet', () => {
  // The regression, named. Probed live: BASE is the only chain of the eight tried
  // that CoinPay refused for this business.
  expect(config.coinpay.chains).not.toContain('BASE');
});

test('the default is a chain we actually offer', () => {
  expect(config.coinpay.chains).toContain(config.coinpay.defaultChain);
});

test('the default is a stablecoin, so fees cannot exceed the top-up', () => {
  // Three cents an image. A default whose network fee costs more than the smallest
  // bundle is not a default.
  expect(config.coinpay.defaultChain.startsWith('USD')).toBe(true);
});

/**
 * Run in a subprocess so the environment is genuinely different, rather than
 * re-importing a module the runtime has already cached with the old values.
 */
async function chainUnderEnv(env) {
  const proc = Bun.spawn(
    ['bun', '-e', "const {config}=await import('./packages/config/src/index.js');console.log(config.coinpay.defaultChain)"],
    {
      env: { ...process.env, ...env },
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: new URL('..', import.meta.url).pathname,
    },
  );
  return (await new Response(proc.stdout).text()).trim();
}

test('a misconfigured COINPAY_CHAIN falls back to a usable one instead of failing at checkout', async () => {
  // This is precisely how the bug reached production: a chain name that is real,
  // spelled correctly, and not ours.
  expect(await chainUnderEnv({ COINPAY_CHAIN: 'BASE' })).toBe('USDC_POL');
  expect(await chainUnderEnv({ COINPAY_CHAIN: 'NONSENSE' })).toBe('USDC_POL');
});

test('an explicitly chosen supported chain is honoured', async () => {
  expect(await chainUnderEnv({ COINPAY_CHAIN: 'USDC_SOL' })).toBe('USDC_SOL');
  expect(await chainUnderEnv({ COINPAY_CHAIN: 'btc' })).toBe('BTC');
});
