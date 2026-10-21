import { beforeAll, expect, test } from 'bun:test';

/**
 * The crawl door (x402-gateway): training crawlers buy a day pass, people do not.
 * No network: the offer and the refusals are built locally.
 */
let app;
let crawlGateway;
beforeAll(async () => {
  process.env.DATABASE_URL ||= 'postgres://localhost/bg0ne_unused';
  process.env.COINPAY_X402_KEY ||= 'cp_live_test_crawl_key';
  process.env.X402_PAY_TO ||= '0xCC3b072391AE7A8d10cF00DdC5F61DB2cA5541E5';
  ({ app, crawlGateway } = await import('../apps/web/src/app.js'));
});

const GPTBOT =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)';
const CHROME = {
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-dest': 'document',
};

test('the crawl gateway is built from the scoped key and payee', () => {
  expect(crawlGateway).not.toBeNull();
});

test('GPTBot gets 402 with a PAYMENT-REQUIRED header', async () => {
  const res = await app.request('/', {
    headers: { 'user-agent': GPTBOT, accept: 'application/json' },
  });
  expect(res.status).toBe(402);
  expect(res.headers.get('payment-required')).toBeTruthy();
});

test('/crawl answers with the offer', async () => {
  const res = await app.request('/crawl', {
    headers: { 'user-agent': 'curl/8', accept: 'application/json' },
  });
  expect(res.status).toBe(402);
  const body = await res.json();
  expect(body.accepts.length).toBeGreaterThan(0);
});

test('a browser with Sec-Fetch headers is not charged', async () => {
  const res = await app.request('/healthz', { headers: CHROME });
  expect(res.status).toBe(200);
});
