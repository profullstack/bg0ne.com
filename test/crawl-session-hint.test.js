import { beforeAll, expect, test } from 'bun:test';

/**
 * The crawl door must not trust a session cookie's mere presence
 * (x402-gateway 0.18.3 `sessionCookie`): GPTBot with a made-up cookie is
 * charged, exactly as without one. No network.
 */
let crawlGateway;
beforeAll(async () => {
  // Set only for the import, then put back (see auth-guard.test.js).
  const env = {
    DATABASE_URL: 'postgres://localhost/bg0ne_unused',
    COINPAY_X402_KEY: 'cp_live_test_crawl_key',
    X402_PAY_TO: '0xCC3b072391AE7A8d10cF00DdC5F61DB2cA5541E5',
    X402_ENABLED: 'true',
  };
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] ||= v;
  }
  try {
    ({ crawlGateway } = await import('../apps/web/src/app.js'));
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)';
const page = (cookie) =>
  new Request('https://example.test/about', {
    headers: { 'user-agent': GPTBOT, accept: 'application/json', 'x-real-ip': '198.51.100.33', ...(cookie ? { cookie } : {}) },
  });

test('the crawl door is built', () => {
  expect(crawlGateway).not.toBeNull();
});

test('a declared crawler is offered a crawl pass', async () => {
  expect((await crawlGateway.handle(page()))?.status).toBe(402);
});

test('a forged session cookie does not exempt it', async () => {
  expect((await crawlGateway.handle(page('bg0ne_session=forged')))?.status).toBe(402);
});
