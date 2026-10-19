/**
 * The pit.world network footer, fetched server-side from pit.world/snippets.
 *
 * Pages are synchronous template strings, so this returns the last copy fetched
 * and refreshes it in the background once it is an hour old. A failed fetch
 * (3 s timeout, non-200, network) keeps serving the stale copy; until the first
 * fetch lands it is the empty string, so the page never breaks on it.
 */
const URL = 'https://pit.world/snippets/footer.html?site=bg0ne.com';
const TTL_MS = 60 * 60 * 1000;

let html = '';
let fetchedAt = 0;
let inflight = null;

function refresh() {
  if (inflight) return inflight;
  inflight = fetch(URL, { signal: AbortSignal.timeout(3000) })
    .then(async (res) => {
      if (!res.ok) throw new Error(`pit footer ${res.status}`);
      const text = await res.text();
      if (!text.includes('data-pit-footer')) throw new Error('pit footer: unexpected body');
      html = text;
      fetchedAt = Date.now();
    })
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

// Warm it at startup so the first page already carries it.
refresh();

export function pitFooter() {
  if (Date.now() - fetchedAt > TTL_MS) refresh();
  return html;
}
