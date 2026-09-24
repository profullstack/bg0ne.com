/**
 * Which tier a request gets, and whether it has to pay first.
 *
 * Pulled out of the route and made pure because this is the billing decision: it
 * decides who gets full resolution and who gets asked for money. A branch of it was
 * wrong for anonymous callers asking for `hd` -- they were silently handed a 640px
 * preview with a 200, which is the precise failure the route comments warn about and
 * which nothing in the suite could see while it lived inside a handler that needs a
 * database and a loaded model to call.
 */

/**
 * @param {object} args
 * @param {string} args.asked      'preview' | 'hd' | 'auto'
 * @param {boolean} args.paidAgent holds a live x402 pass, so already paid per call
 * @param {boolean} args.hasUser   a session or api key resolved to an account
 * @param {boolean} args.canSpend  that account had a credit to spend
 * @returns {{tier: 'preview'|'hd', refuse: null | {reason: string}}}
 */
export function decideTier({ asked, paidAgent, hasUser, canSpend }) {
  if (asked === 'preview') return { tier: 'preview', refuse: null };

  if (paidAgent) return { tier: 'hd', refuse: null };
  if (hasUser && canSpend) return { tier: 'hd', refuse: null };

  /*
   * Could not give full resolution.
   *
   * Asked for it explicitly -> 402, always. Downgrading an explicit `tier=hd` to a
   * preview and answering 200 tells the caller nothing went wrong while handing them
   * the wrong image, and an API client has no way to notice.
   *
   * Asked for `auto` -> a preview is the right answer and the honest one: that is a
   * browser saying "whatever I am entitled to".
   */
  if (asked === 'hd') {
    return {
      tier: 'preview',
      refuse: {
        reason: hasUser ? 'no credits' : 'full resolution needs credits or an x402 payment',
      },
    };
  }
  return { tier: 'preview', refuse: null };
}
