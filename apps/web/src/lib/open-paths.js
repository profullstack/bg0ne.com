/**
 * Paths that are never metered and never sold.
 *
 * READ THIS BEFORE ADDING ONE. The matcher behind these is:
 *
 *   pattern ends in "/"  ->  prefix match
 *   otherwise            ->  exact match
 *
 * So "/" is not "the home page". It is a prefix that matches every path on the
 * site, and adding it opens everything: the throttle stops counting, the x402
 * gate stops offering, and the only symptom is that nothing ever gets refused.
 * That shipped here once and took a load test to notice, because a site that
 * refuses nobody looks exactly like a site nobody is abusing.
 *
 * What belongs here is only what a REFUSED caller must be able to read in order
 * to pay: the price and the instructions. Everything else, the tool included, is
 * metered.
 */
export const OPEN_PATHS = [
  // Exact, so the landing page and anything below it stay metered.
  '/pricing',
  '/docs',
  // Trailing-slash twins, so a future /docs/whatever is open too. Deliberate
  // prefixes, unlike the accident above.
  '/pricing/',
  '/docs/',
  '/healthz',
];

/** The subset the rate limiter also skips: liveness and crawler boilerplate. */
export const UNMETERED_PATHS = ['/healthz', '/robots.txt', '/sitemap.xml'];
