import * as auth from '@bg0ne/auth';
import { config } from '@bg0ne/config';
import * as q from '@bg0ne/db/queries';
import { sendLoginLink, sendTopupReceipt } from '@bg0ne/notify';
import { cutout, CutoutError } from '@bg0ne/cutout';
import * as pay from '@bg0ne/payments';
import { createGateway } from '@profullstack/x402-gateway';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { throttle } from '@profullstack/throttle/hono';
import { OPEN_PATHS, UNMETERED_PATHS } from './lib/open-paths.js';
import { decideTier } from './lib/tier.js';
import {
  Account,
  Docs,
  Gone,
  History,
  Keys,
  Landing,
  NotFound,
  Pricing,
  Sent,
  SharePage,
  SignIn,
} from './views/pages.js';

export const app = new Hono();

/* ------------------------------------------------------------------ callers -- */

/**
 * Who is asking: a browser session, an API key, or nobody.
 *
 * Nobody is a first-class answer. An anonymous caller gets a real preview without an
 * account, which is the entire top of the funnel -- a signup wall in front of "does
 * this even work on my photo" is how a tool like this dies before anyone tries it.
 */
async function caller(c) {
  const bearer = c.req.header('authorization');
  if (bearer) {
    const user = await auth.userFromApiKey(bearer);
    if (user) return { user, apiKeyId: user.api_key_id, via: 'api-key' };
  }
  const user = await auth.userFromRequest(getCookie(c, config.session.cookie));
  return user ? { user, apiKeyId: null, via: 'session' } : { user: null, apiKeyId: null, via: null };
}

/* -------------------------------------------------------------------- x402 -- */

/**
 * The agent door.
 *
 * Built only when it is configured. A gateway with no payee would answer 402 with an
 * offer naming an empty address, and an agent that paid it would send USDC nowhere
 * recoverable -- so an unconfigured x402 is off, not broken.
 */
const gateway = config.x402.enabled
  ? createGateway({
      siteUrl: config.siteUrl,
      siteName: 'bg0ne',
      coinpay: { apiKey: config.x402.scopedKey, baseUrl: config.coinpay.baseUrl },
      payTo: config.x402.payTo,
      priceCents: config.x402.priceCents,
      currency: config.x402.currency,
      passMinutes: config.x402.passMinutes,
      // See lib/open-paths.js. '/' is NOT the home page here: it is a prefix that
      // matches every path, and it opened the whole site until a load test caught it.
      openPaths: OPEN_PATHS,
    })
  : null;

/**
 * Meter everything, and sell a pass to whoever goes over.
 *
 * A signed-in person is exempt: they are metered by their credit balance instead, and
 * charging the same request twice would be selling the same work to the same buyer
 * two ways. Health checks are never counted or Railway's probe eats the allowance.
 */
app.use(
  '*',
  throttle({
    gateway,
    limit: config.throttle.limit,
    windowSeconds: config.throttle.windowSeconds,
    openPaths: UNMETERED_PATHS,
    exempt: (request) => Boolean(request.headers.get('cookie')?.includes(config.session.cookie)),
  }),
);

/* ------------------------------------------------------------------- pages -- */

const html = (c, body, status = 200) => c.html(body, status);

app.get('/healthz', (c) => c.text('ok'));

app.get('/', (c) => html(c, Landing({ config })));
app.get('/pricing', (c) => html(c, Pricing({ config })));
app.get('/docs', (c) => html(c, Docs({ config })));

app.get('/signin', (c) => html(c, SignIn({})));

app.get('/account', async (c) => {
  const { user } = await caller(c);
  if (!user) return c.redirect('/signin');
  const [balance, ledger] = await Promise.all([
    q.creditBalance(user.id),
    q.creditHistory(user.id),
  ]);
  return html(c, Account({ user, balance, ledger, config }));
});

/**
 * Everything this account has run.
 *
 * Driven from the cutout rows rather than the stored images, so a result whose
 * image has expired still appears as something that happened and was paid for. A
 * history that quietly loses its oldest entries is worse than no history, because
 * it looks complete.
 */
app.get('/account/history', async (c) => {
  const { user } = await caller(c);
  if (!user) return c.redirect('/signin');
  const rows = await q.cutoutHistory(user.id);
  return html(c, History({ user, rows, config }));
});

app.get('/account/keys', async (c) => {
  const { user } = await caller(c);
  if (!user) return c.redirect('/signin');
  const keys = await q.listApiKeys(user.id);
  return html(c, Keys({ user, keys, config }));
});

/* -------------------------------------------------------------------- auth -- */

app.post('/auth/link', async (c) => {
  const form = await c.req.parseBody();
  const email = String(form.email ?? '').trim();

  /*
   * Answer identically no matter what happens next.
   *
   * A different response for a known address turns this form into a way to ask
   * "does this person have an account here", and a rate limit reported as a failure
   * does the same thing more slowly. Both are answered as success.
   */
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    try {
      const url = await auth.createLoginLink(email);
      if (config.mail.enabled) await sendLoginLink({ email, url });
      else console.log(`[auth] mail disabled; link for ${email}: ${url}`);
    } catch (err) {
      console.error(`[auth] could not send link: ${err?.message ?? err}`);
    }
  }
  return html(c, Sent({ email }));
});

app.get('/auth/magic', async (c) => {
  const token = c.req.query('t');
  const session = token
    ? await auth.consumeLoginLink(token, { userAgent: c.req.header('user-agent') })
    : null;
  if (!session) return html(c, SignIn({ error: 'That link has expired or was already used.' }), 400);
  c.header('set-cookie', auth.sessionCookie(session.sessionId));
  return c.redirect('/account');
});

app.post('/auth/signout', async (c) => {
  const sid = getCookie(c, config.session.cookie);
  if (sid) await q.endSession(sid);
  c.header('set-cookie', auth.sessionCookie('', { clear: true }));
  return c.redirect('/');
});

app.post('/account/keys', async (c) => {
  const { user } = await caller(c);
  if (!user) return c.json({ error: 'sign in first' }, 401);
  const key = await auth.createApiKey({ userId: user.id, name: 'default' });
  // The plaintext exists in exactly one response, ever. Say so where it is shown.
  return c.json({ key: key.plaintext, prefix: key.prefix, shown_once: true });
});

/* ------------------------------------------------------------------ cutout -- */

/**
 * The whole product.
 *
 * Tiering, in one place so it can be read as one decision:
 *
 *   an agent holding an x402 pass  -> full resolution, already paid for per call
 *   a signed-in caller with credit -> full resolution, one credit spent atomically
 *   anyone at all                  -> a preview, capped by pixels, free and unmetered
 *
 * The preview is capped by EDGE LENGTH rather than by a count of images. A count is
 * what forces a wall in front of a first-time visitor; a pixel cap lets them run as
 * many as they like and still leaves something worth paying for.
 */
app.post('/api/cutout', async (c) => {
  const started = Date.now();
  const body = await c.req.parseBody();
  const file = body.file;
  if (!file || typeof file === 'string') {
    return c.json({ error: 'attach an image as `file`' }, 400);
  }

  const { user, apiKeyId } = await caller(c);
  const asked = String(body.tier ?? 'auto');

  // A live x402 pass means this request is already paid for. The gateway put it there.
  const paidAgent = Boolean(c.req.header('x-crawl-pass') || c.req.header('x-payment'));

  // Only spend if full resolution is actually on the table; a spend for a caller who
  // was going to get a preview anyway is a charge for nothing.
  let spend = null;
  if (asked !== 'preview' && !paidAgent && user) {
    spend = await q.spendCredits({ userId: user.id, cost: 1, reason: 'cutout' });
  }

  const { tier, refuse } = decideTier({
    asked,
    paidAgent,
    hasUser: Boolean(user),
    canSpend: Boolean(spend),
  });

  if (refuse) {
    return c.json(
      {
        error: refuse.reason,
        price_cents: config.pricing.hdCents,
        topup: `${config.siteUrl}/pricing`,
        docs: `${config.siteUrl}/docs`,
      },
      402,
    );
  }

  const model = tier === 'hd' ? config.infer.hdModel : config.infer.model;
  const maxEdge = tier === 'hd' ? 0 : config.pricing.previewMaxEdge;

  try {
    const { png, meta } = await cutout({ file, model, maxEdge });
    const id = await q.recordCutout({
      userId: user?.id ?? null,
      apiKeyId,
      tier,
      model: meta.model,
      width: meta.width,
      height: meta.height,
      bytesIn: file.size ?? null,
      bytesOut: png.byteLength,
      durationMs: meta.durationMs,
      payer: paidAgent ? (c.req.header('x-payer') ?? 'x402') : null,
    });

    /*
     * Keep the result so it has a URL.
     *
     * Every cutout gets one, free or paid -- a preview somebody wants to send to a
     * colleague is the cheapest advertising this site has, and making the share the
     * paid tier's privilege would take it away from exactly the people who spread it.
     *
     * Failing here must not fail the cutout. The image is already made and the
     * caller is holding the request open for it; a share link is a nicety and losing
     * one is worth strictly less than losing the thing they asked for.
     */
    let share = null;
    try {
      /*
       * Keep the original too, so the share can show before as well as after.
       *
       * Read here rather than earlier: a Blob can be read more than once, and there
       * is no reason to hold a second copy of a 20MB upload in memory while the
       * model is still working on it. If the cutout had failed we would never have
       * needed these bytes at all.
       */
      const source = await file.arrayBuffer().catch(() => null);

      share = await q.createShare({
        cutoutId: id,
        userId: user?.id ?? null,
        png,
        width: meta.width,
        height: meta.height,
        tier,
        model: meta.model,
        source,
        // What the browser said it uploaded. Served back verbatim rather than
        // relabelled as PNG, which would make a JPEG that browsers still render but
        // that is quietly lying about itself.
        sourceContentType: file.type || 'application/octet-stream',
        sourceWidth: meta.sourceWidth,
        sourceHeight: meta.sourceHeight,
        ttlDays: config.shares.ttlDays,
        maxBytes: config.shares.maxBytes,
      });
    } catch (shareErr) {
      console.error(`[share] not stored for ${id}: ${shareErr?.message ?? shareErr}`);
    }

    c.header('content-type', 'image/png');
    c.header('x-cutout-id', id);
    c.header('x-cutout-tier', tier);
    c.header('x-cutout-model', meta.model);
    c.header('x-cutout-ms', String(Date.now() - started));
    if (share) {
      c.header('x-share-url', `${config.siteUrl}/c/${share.id}`);
      c.header('x-share-expires', new Date(share.expires_at).toISOString());
    }
    if (spend) c.header('x-credits-remaining', String(spend.remaining));
    // A preview is deliberately not cacheable as if it were the real thing.
    c.header('cache-control', 'no-store');
    return c.body(png);
  } catch (err) {
    /*
     * The credit is given back when the model fails.
     *
     * It was spent before the work, which is the only way to stop two concurrent
     * requests spending the same last credit -- so when the work does not happen the
     * refund has to be explicit. A failed cutout that still costs a credit is the
     * single fastest way to lose somebody who just paid.
     */
    if (spend && user) {
      await q
        .refundCredits({ userId: user.id, credits: spend.spent, reason: 'cutout failed' })
        .catch((refundErr) =>
          // Loud: the customer has been charged for work that did not happen and the
          // automatic repair just failed too. This one needs a human.
          console.error(`[cutout] REFUND FAILED for ${user.id}: ${refundErr?.message ?? refundErr}`),
        );
    }
    const status = err instanceof CutoutError ? err.status : 500;
    console.error(`[cutout] ${err?.message ?? err}`);
    return c.json({ error: String(err?.message ?? err).slice(0, 300) }, status);
  }
});

/* ------------------------------------------------------------------- money -- */

app.post('/api/topup', async (c) => {
  const { user } = await caller(c);
  if (!user) return c.json({ error: 'sign in first' }, 401);
  if (!pay.paymentsEnabled()) return c.json({ error: 'payments are not configured' }, 503);

  const body = await c.req.parseBody();
  const cents = Number(body.cents ?? 0);
  const bundle = config.pricing.topups.find((t) => t.cents === cents);
  // Only the published bundles. Taking an arbitrary amount from the request lets a
  // caller name its own price for a fixed number of credits.
  if (!bundle) return c.json({ error: 'pick one of the published bundles' }, 400);

  /*
   * The chain has to be one this business actually holds a wallet for.
   *
   * CoinPay resolves the payee from the business's own wallets and refuses anything
   * else with a 400 at the moment of purchase. Checking here means a bad chain is a
   * clear 400 from us rather than a 500 from a rejected upstream call, which is what
   * the buy button did when the default was set to a chain we had no wallet on.
   */
  const chain = String(body.chain ?? config.coinpay.defaultChain).toUpperCase();
  if (!config.coinpay.chains.includes(chain)) {
    return c.json({ error: `unsupported chain ${chain}`, chains: config.coinpay.chains }, 400);
  }

  try {
    const { checkoutUrl, paymentRef } = await pay.createCheckout({
      user,
      amountCents: bundle.cents,
      description: `${bundle.credits} bg0ne credits`,
      metadata: { credits: String(bundle.credits) },
      blockchain: chain,
      successUrl: `${config.siteUrl}/account`,
      cancelUrl: `${config.siteUrl}/pricing`,
    });
    return c.json({ checkout_url: checkoutUrl, payment_ref: paymentRef });
  } catch (err) {
    /*
     * Say what went wrong.
     *
     * An unhandled throw here is a bare 500 and the page had nothing to show but a
     * button that did nothing. Whatever CoinPay refused, the buyer is better served
     * by reading it than by watching the click evaporate.
     */
    const message = String(err?.message ?? err);
    console.error(`[topup] checkout failed for ${user.id} on ${chain}: ${message}`);
    return c.json({ error: 'could not start checkout', detail: message.slice(0, 200) }, 502);
  }
});

/**
 * CoinPay calls this when money moves.
 *
 * The raw body is what the signature covers; re-serialising the parsed JSON changes
 * key order and the signature stops matching, which reads as a forgery rather than
 * the bug it is.
 */
app.post('/webhooks/coinpay', async (c) => {
  const raw = await c.req.text();
  const ok = pay.verifyWebhook({
    rawBody: raw,
    signatureHeader: c.req.header('x-coinpay-signature') ?? c.req.header('coinpay-signature'),
  });
  if (!ok) return c.json({ error: 'bad signature' }, 401);

  const payload = JSON.parse(raw);
  let receipt = null;

  const result = await pay.settleWebhook(payload, {
    async grant(tx, { meta, payment }) {
      /*
       * How many credits, decided from what WE charged.
       *
       * `payment.amount_cents` is the row written at checkout, not a number that
       * arrived over the wire. Trusting the payload's amount would let anyone who
       * can forge a body -- or replay an old one -- name their own credit total.
       */
      const bundle = config.pricing.topups.find((t) => t.cents === payment.amount_cents);
      const credits = bundle?.credits ?? Number(meta.credits ?? 0);
      if (!credits) return null;

      const granted = await q.grantCredits(tx, {
        userId: meta.user_id,
        credits,
        paymentId: payment.id,
        reason: 'topup',
      });
      // Only worth emailing about the first time. A retried webhook grants nothing and
      // must not send a second receipt for the same money.
      if (granted.granted) receipt = { credits, amountCents: payment.amount_cents };
      return granted.granted || { alreadyGranted: true };
    },
  });

  if (receipt) {
    const email = await q.userEmail(payload?.metadata?.user_id);
    if (email && config.mail.enabled) {
      sendTopupReceipt({ email, ...receipt }).catch((err) =>
        console.error(`[mail] receipt not sent: ${err?.message ?? err}`),
      );
    }
  }

  // 2xx even when nothing was granted. CoinPay retries anything else, and a webhook
  // for a cancelled payment is correctly handled by recording it and doing nothing.
  return c.json({ ok: true, ...result });
});

/* ------------------------------------------------------------------ sharing -- */

/**
 * A shared result.
 *
 * The id IS the capability: an unguessable v4 uuid is the only thing standing
 * between a link and somebody's photograph. So these are `noindex` -- a search
 * engine that crawls one shared link and publishes it has turned a private URL into
 * a public one, and nobody who pressed "copy link" agreed to that.
 */
app.get('/c/:id', async (c) => {
  const meta = await q.getShareMeta(c.req.param('id'));
  if (!meta) return html(c, Gone({ config }), 404);
  c.header('x-robots-tag', 'noindex, nofollow');
  return html(c, SharePage({ share: meta, config }));
});

/*
 * A separate segment rather than "/c/:id.png".
 *
 * Hono's matcher reads ":id.png" as one parameter token and the dot is not the
 * separator it looks like, so the raw image and the page end up fighting over the
 * same route. A path segment is unambiguous.
 */
app.get('/c/:id/image.png', async (c) => {
  const share = await q.getShare(c.req.param('id'));
  if (!share) return c.text('gone', 404);
  c.header('content-type', share.content_type ?? 'image/png');
  c.header('x-robots-tag', 'noindex, nofollow');
  // Immutable for a day: the bytes behind an id never change, but the id expires,
  // so this must not be cached past the point where we stop serving it.
  c.header('cache-control', 'public, max-age=86400');
  return c.body(share.png);
});

/**
 * The original, when one was small enough to keep.
 *
 * Served with the content type it arrived as. This is the more sensitive of the two
 * images -- the cutout has had its background removed and this has not -- so it
 * carries the same noindex and sits behind the same single unguessable id.
 */
app.get('/c/:id/original', async (c) => {
  const row = await q.getShareSource(c.req.param('id'));
  if (!row) return c.text('gone', 404);
  c.header('content-type', row.source_content_type ?? 'application/octet-stream');
  c.header('x-robots-tag', 'noindex, nofollow');
  c.header('cache-control', 'public, max-age=86400');
  return c.body(row.source);
});

app.post('/c/:id/delete', async (c) => {
  const { user } = await caller(c);
  if (!user) return c.json({ error: 'sign in first' }, 401);
  const ok = await q.deleteShare({ id: c.req.param('id'), userId: user.id });
  return c.json({ deleted: ok });
});

/* -------------------------------------------------------------- boilerplate -- */

app.get('/robots.txt', (c) =>
  c.text(
    ['User-agent: *', 'Allow: /', '', `Sitemap: ${config.siteUrl}/sitemap.xml`, ''].join('\n'),
  ),
);

app.get('/sitemap.xml', (c) => {
  const urls = ['/', '/pricing', '/docs', '/signin'];
  c.header('content-type', 'application/xml');
  return c.body(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
      .map((u) => `  <url><loc>${config.siteUrl}${u}</loc></url>`)
      .join('\n')}\n</urlset>\n`,
  );
});

app.notFound((c) => html(c, NotFound({}), 404));
