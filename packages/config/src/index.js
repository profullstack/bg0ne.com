/**
 * One place that reads the environment, so no other module ever touches process.env.
 *
 * Everything required is read once at import and throws here, at boot, rather than at
 * the moment a customer presses pay. Secrets live in the logicsrc vault and reach the
 * container as Railway variables; there is deliberately no .env loading in this file.
 */

/** @param {string} name @param {string} [fallback] */
function req(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required env var ${name}`);
  return v;
}

/** @param {string} name @param {string} [fallback] */
const opt = (name, fallback = '') => process.env[name] ?? fallback;

/** @param {string} name @param {number} fallback */
const num = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`env ${name} must be a number, got ${raw}`);
  return n;
};

/** @param {string} name @param {boolean} fallback */
const bool = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
};

export const config = {
  env: opt('NODE_ENV', 'development'),
  isProd: opt('NODE_ENV', 'development') === 'production',

  /** Railway injects PORT. Never hardcode it -- a fixed port makes every request 404
   *  behind the edge proxy while the container still reports healthy. */
  port: num('PORT', 3000),

  /** Public origin. The passkey rpID is derived from this, so changing it invalidates
   *  every credential already registered. */
  siteUrl: opt('SITE_URL', 'http://localhost:3000').replace(/\/$/, ''),

  /** No fallback, deliberately: a service deployed without DATABASE_URL otherwise
   *  dials localhost and dies with a Postgres driver error that names nothing. */
  databaseUrl: req('DATABASE_URL'),

  /** Which roles this process runs. One service runs "web,infer"; splitting the
   *  model onto a GPU box later is a variable change, not a code change. */
  roles: opt('ROLES', 'web,infer')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  session: {
    cookie: opt('SESSION_COOKIE', 'bg0ne_session'),
    ttlDays: num('SESSION_TTL_DAYS', 30),
  },

  mail: {
    get enabled() {
      return Boolean(process.env.RESEND_API_KEY);
    },
    get resendKey() {
      return process.env.RESEND_API_KEY ?? '';
    },
    from: opt('MAIL_FROM', 'bg0ne <noreply@bg0ne.com>'),
  },

  /**
   * The model service.
   *
   * `infer` is a local Python process in the same container by default, because one
   * image and one Railway service is the house shape. Pointing INFER_URL at a GPU box
   * is how this scales without touching code.
   */
  infer: {
    url: opt('INFER_URL', 'http://127.0.0.1:7001').replace(/\/$/, ''),
    /**
     * Which open model answers.
     *
     * birefnet-general is the best of them and also the slowest; u2net is the one that
     * survives a CPU-only container. Both are permissively licensed, which is the whole
     * reason they are the two on offer -- see MODELS.md. BRIA RMBG is deliberately absent:
     * its weights are CC BY-NC and cannot back anything anyone pays for.
     */
    model: opt('INFER_MODEL', 'u2net'),
    /**
     * The paid model.
     *
     * isnet-general-use rather than birefnet-general, for now, and the reason is
     * operational rather than aesthetic: BiRefNet is the better model and is MIT, but
     * the weights are about a gigabyte and it wants a GPU to be worth the wait. ISNet
     * is Apache-2.0, small enough to bake into the image, and visibly better than the
     * preview model -- which is what the paid tier has to be. Set INFER_HD_MODEL once
     * there is a GPU under this.
     */
    hdModel: opt('INFER_HD_MODEL', 'isnet-general-use'),
    timeoutMs: num('INFER_TIMEOUT_MS', 120_000),
    /** Spawned by this container when ROLES includes `infer`. */
    spawn: bool('INFER_SPAWN', true),
    port: num('INFER_PORT', 7001),
  },

  /**
   * What a cutout costs, in cents, and what you get without paying.
   *
   * The free tier is capped by PIXELS rather than by a count, because a count is what
   * forces a signup wall in front of somebody who just wants to see whether the thing
   * works at all. A preview is genuinely free and genuinely unlimited; the money is in
   * full resolution.
   */
  pricing: {
    previewMaxEdge: num('PREVIEW_MAX_EDGE', 640),
    hdCents: num('HD_CENTS', 3),
    /** Top-up bundles, cents -> credits. Credits never expire; that is the pitch. */
    topups: [
      { cents: 500, credits: 200 },
      { cents: 2000, credits: 1000 },
      { cents: 10_000, credits: 6000 },
    ],
  },

  /**
   * CoinPay.
   *
   * These are GETTERS on purpose. The payments package is copied verbatim between
   * brands and reads this object on every access; snapshotting the values at import
   * made the effective key depend on which module imported config first, which turned
   * the webhook signature tests into a coin flip decided by the rest of the suite.
   */
  coinpay: {
    get enabled() {
      return Boolean(process.env.COINPAY_API_KEY && process.env.COINPAY_BUSINESS_ID);
    },
    get baseUrl() {
      return (process.env.COINPAY_API_URL ?? 'https://coinpayportal.com').replace(/\/$/, '');
    },
    get apiKey() {
      return process.env.COINPAY_API_KEY ?? '';
    },
    get businessId() {
      return process.env.COINPAY_BUSINESS_ID ?? '';
    },
    get webhookSecret() {
      return process.env.COINPAY_WEBHOOK_SECRET ?? '';
    },
    /** Chain the hosted checkout settles on unless the buyer picks another. */
    defaultChain: opt('COINPAY_CHAIN', 'BASE'),
  },

  /**
   * Agent-native metering. A bot pays per call and never makes an account.
   *
   * This is the thing remove.bg structurally cannot offer: no signup, no key, no
   * card, just a paid request. It is also the reason the free tier can stay generous,
   * because the callers that would abuse it are the ones with a way to pay.
   */
  x402: {
    /**
     * A SCOPED CoinPay key (Businesses -> API Keys), NOT the merchant key above.
     *
     * CoinPay's x402 verify and settle routes resolve the merchant from
     * `business_api_keys` only; the cp_live_ key that checkout uses is refused there
     * with "Invalid or inactive API key". Same shape, different table -- and the
     * failure is invisible until the moment an agent actually pays.
     */
    get scopedKey() {
      return process.env.COINPAY_X402_KEY ?? '';
    },
    /**
     * The EVM address the USDC lands in.
     *
     * The one payee the business cannot resolve for itself: x402 verify holds the
     * proof against whatever address the offer named and never looks the merchant's
     * wallets up. So unlike a checkout, this one genuinely is configuration.
     */
    get payTo() {
      return process.env.X402_PAY_TO ?? '';
    },
    get enabled() {
      return bool('X402_ENABLED', false) && Boolean(this.payTo && this.scopedKey);
    },
    /** What one HD cutout costs an agent, in cents. Money is never a float. */
    priceCents: num('X402_PRICE_CENTS', 3),
    currency: opt('X402_CURRENCY', 'USD'),
    /** A pass, for an agent doing a batch rather than a single image. */
    passMinutes: num('X402_PASS_MINUTES', 60),
  },

  /** The free allowance before a caller is asked to pay. Previews only. */
  throttle: {
    limit: num('THROTTLE_LIMIT', 60),
    windowSeconds: num('THROTTLE_WINDOW_SECONDS', 60),
  },
};

/**
 * Fail at boot rather than at checkout if the CoinPay credential is the wrong family.
 *
 * `cp_live_` and `cp_test_` take money. A bare `cp_` or `cps_` is a scoped read key and
 * will be refused by /api/payments/create with an authorization error that reads like a
 * misconfigured header rather than the wrong key entirely.
 */
export function assertCoinpayMerchantKey() {
  if (!config.coinpay.enabled) return;
  const key = config.coinpay.apiKey;
  if (!/^cp_(live|test)_/.test(key)) {
    throw new Error(
      'COINPAY_API_KEY is not a merchant key: payments need cp_live_ or cp_test_, ' +
        `got ${key.slice(0, 8)}… (a cp_/cps_ scoped key cannot create a payment)`,
    );
  }
}
