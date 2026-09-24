import { assertCoinpayMerchantKey, config } from '@bg0ne/config';
import { close as closeDb, healthcheck, sql } from '@bg0ne/db';
import * as q from '@bg0ne/db/queries';
import { migrate } from '@bg0ne/db/migrate';
import { configurePayments } from '@bg0ne/payments';
import { startInfer, stopInfer, waitForInfer } from '@bg0ne/cutout';
import { app } from './app.js';

/*
 * Hand the payments package its database handle and settings.
 *
 * It imports nothing from this brand -- that is what lets the same file live in every
 * sibling unchanged -- so it has to be given `sql` and the CoinPay block once, here,
 * before anything can take money. The coinpay object is passed WHOLE rather than
 * unpacked: its keys are getters that read the environment on every access, and
 * snapshotting them is the bug their comment in config warns about.
 */
configurePayments({ sql, coinpay: config.coinpay, siteUrl: config.siteUrl });

// Fail at boot rather than at checkout if the CoinPay credential is the wrong family.
assertCoinpayMerchantKey();

/**
 * Turn an infrastructure failure into a sentence someone can act on.
 *
 * A container that cannot reach Postgres dies with ERR_POSTGRES_CONNECTION_CLOSED and
 * a stack trace inside Bun's driver, which is indistinguishable from a bug in this app
 * when the actual cause is a variable nobody set on the service.
 */
async function preflight(what, fn) {
  try {
    return await fn();
  } catch (err) {
    let host = 'unparseable';
    try {
      // Host only -- a connection string carries the password.
      host = new URL(config.databaseUrl).host;
    } catch {}
    console.error(
      `[boot] cannot reach ${what} at ${host}: ${err?.message ?? err}\n` +
        '[boot] check DATABASE_URL on this service (Railway does not share variables ' +
        'between services, so a database in another project is not reachable).',
    );
    throw err;
  }
}

// Migrations apply themselves; an advisory lock inside makes that safe when more than
// one container boots at the same moment.
await preflight('postgres', () => migrate());
if (!(await healthcheck())) throw new Error('database healthcheck failed at boot');

/*
 * Start the model and wait for it BEFORE listening.
 *
 * Railway decides a deploy succeeded when /healthz answers. If this listened first, a
 * container still loading weights would report healthy and then serve timeouts to
 * every real request -- a green deploy in front of a broken site. Not listening at all
 * is the honest signal, and `healthcheckTimeout` in railway.json is set well above the
 * wait below to give it room.
 */
startInfer();
if (config.roles.includes('infer')) {
  const ready = await waitForInfer({ timeoutMs: 240_000 });
  if (!ready) {
    // Deliberately not fatal. A model that is slow to warm still recovers, and a
    // container that exits here would crash-loop instead of coming good.
    console.error('[boot] model not ready; serving anyway, cutouts will fail until it is');
  }
}

/*
 * Delete shared images that have passed their date.
 *
 * The read path already refuses an expired share, so this is about not keeping other
 * people's photographs rather than about correctness. It runs on boot and on an
 * interval; every instance running it is harmless because the delete is idempotent
 * and indexed.
 */
async function purgeShares() {
  try {
    const n = await q.purgeExpiredShares();
    if (n > 0) console.log(`[shares] purged ${n} expired`);
  } catch (err) {
    // Never fatal: failing to tidy up must not take the site down.
    console.warn(`[shares] purge failed: ${err?.message ?? err}`);
  }
}
await purgeShares();
const purgeTimer = setInterval(purgeShares, config.shares.purgeIntervalMinutes * 60_000);

// Railway injects PORT. Never hardcode it: a fixed port leaves the edge proxy talking
// to a closed socket while the container still reports healthy.
const server = Bun.serve({ port: config.port, fetch: app.fetch, idleTimeout: 120 });
console.log(`[web] listening on :${server.port} as ${config.roles.join('+')}`);
console.log(`[web] site ${config.siteUrl} · payments ${config.coinpay.enabled ? 'on' : 'off'} · x402 ${config.x402.enabled ? 'on' : 'off'}`);

async function shutdown(signal) {
  console.log(`[main] ${signal}, draining`);
  clearInterval(purgeTimer);
  await Promise.allSettled([server.stop(true)]);
  stopInfer();
  await closeDb();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
