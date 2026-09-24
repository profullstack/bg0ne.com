import { expect, test } from 'bun:test';
import { matchesAny } from '@profullstack/throttle';
import { OPEN_PATHS, UNMETERED_PATHS } from '../apps/web/src/lib/open-paths.js';

/**
 * These assert against the throttle package's OWN matcher rather than against a
 * local reimplementation of it, because the bug being guarded here was a
 * misunderstanding of that matcher: a trailing slash means prefix, so "/" matches
 * every path on the site.
 *
 * Shipping "/" in openPaths opened everything. The throttle stopped counting and
 * the x402 gate stopped offering, and nothing looked wrong, because a site that
 * refuses nobody is indistinguishable from a site nobody is abusing. It took 80
 * requests in 5 seconds against production to see it.
 */

const MUST_STAY_METERED = [
  '/',
  '/api/cutout',
  '/api/topup',
  '/signin',
  '/account',
  '/account/keys',
  '/auth/link',
  '/webhooks/coinpay',
  '/anything/else/at/all',
];

test('no open path leaves the tool or the home page unmetered', () => {
  for (const path of MUST_STAY_METERED) {
    expect(matchesAny(OPEN_PATHS, path)).toBe(false);
  }
});

test('"/" is never an open path, because it matches every path', () => {
  expect(OPEN_PATHS).not.toContain('/');
  expect(UNMETERED_PATHS).not.toContain('/');
  // And prove why, rather than just asserting the taboo.
  expect(matchesAny(['/'], '/api/cutout')).toBe(true);
});

test('a refused caller can still read the price and the instructions', () => {
  for (const path of ['/pricing', '/docs']) {
    expect(matchesAny(OPEN_PATHS, path)).toBe(true);
  }
});

test('documentation subpaths are open, so future pages do not need a deploy to fix', () => {
  expect(matchesAny(OPEN_PATHS, '/docs/self-hosting')).toBe(true);
  expect(matchesAny(OPEN_PATHS, '/pricing/enterprise')).toBe(true);
});

test('liveness and crawler boilerplate are never metered', () => {
  for (const path of ['/healthz', '/robots.txt', '/sitemap.xml']) {
    expect(matchesAny(UNMETERED_PATHS, path)).toBe(true);
  }
});
