import { beforeAll, expect, test } from 'bun:test';

/** The PWA manifest + icons pwamart.com's inspector checks: served, typed, linked. */

let app;

beforeAll(async () => {
  ({ app } = await import('../src/app.js'));
});

test('manifest is served as JSON with name, display and 192/512 icons', async () => {
  const res = await app.request('/manifest.webmanifest');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toBe('application/manifest+json');
  const m = await res.json();
  expect(m.name).toBeTruthy();
  expect(m.short_name).toBeTruthy();
  expect(m.display).toBe('standalone');
  expect(m.start_url).toBe('/');
  const sizes = m.icons.filter((i) => i.type === 'image/png').map((i) => i.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
});

test('icons are PNGs', async () => {
  for (const path of ['/icon-192.png', '/icon-512.png']) {
    const res = await app.request(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const head = new Uint8Array(await res.arrayBuffer()).slice(0, 4);
    expect([...head]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }
});

test('every page links the manifest', async () => {
  const html = await (await app.request('/pricing')).text();
  expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
});
