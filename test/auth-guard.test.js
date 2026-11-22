import { beforeAll, expect, test } from 'bun:test';

/**
 * Sign-in is a brute-force guard (throttle 0.5.0): over the limit is a plain 429
 * with no x402 offer, and nothing a caller writes in a header gets around it.
 */
let app;
beforeAll(async () => {
  // Set only for the import, then put back: other files decide whether a database is
  // available from DATABASE_URL, and a fake one left behind fails every one of them.
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
    ({ app } = await import('../apps/web/src/app.js'));
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

const BROWSER = {
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-dest': 'document',
  'content-type': 'application/x-www-form-urlencoded',
  accept: 'application/json',
};

// A malformed address never reaches the database: the handler answers "sent" at once.
const login = (ip, extra = {}) =>
  app.request('/auth/link', {
    method: 'POST',
    headers: { ...BROWSER, 'x-real-ip': ip, ...extra },
    body: 'email=not-an-address',
  });

async function expectGuarded(ip, extra) {
  for (let i = 0; i < 10; i++) {
    const res = await login(ip, extra);
    expect([402, 429]).not.toContain(res.status);
  }
  const res = await login(ip, extra);
  expect(res.status).toBe(429);
  expect(res.headers.get('retry-after')).toBeTruthy();
  expect(res.headers.get('payment-required')).toBeNull();
  const body = await res.text();
  expect(body).not.toContain('accepts');
}

test('the 11th sign-in attempt in a minute is 429 with no x402 offer', async () => {
  await expectGuarded('198.51.100.11');
});

test('a forged session cookie does not skip the sign-in guard', async () => {
  await expectGuarded('198.51.100.12', { cookie: 'bg0ne_session=forged' });
});

test('an Authorization header does not buy a bigger sign-in budget', async () => {
  await expectGuarded('198.51.100.13', { authorization: 'Bearer made-up' });
});

test('the CoinPay OAuth callback is guarded too', async () => {
  const hit = () =>
    app.request('/api/v1/coinpay/oauth/callback?code=x&state=y', {
      headers: { ...BROWSER, 'x-real-ip': '198.51.100.14' },
    });
  for (let i = 0; i < 10; i++) await hit();
  const res = await hit();
  expect(res.status).toBe(429);
  expect(await res.text()).not.toContain('accepts');
});
