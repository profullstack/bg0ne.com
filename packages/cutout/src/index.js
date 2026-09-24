import { spawn } from 'node:child_process';
import { config } from '@bg0ne/config';

/**
 * The web app's side of the model.
 *
 * Everything here is HTTP against config.infer.url, so "the model runs in this
 * container" and "the model runs on a rented GPU" are the same code path with a
 * different variable. The spawn helper below is only used for the first case.
 */

/* -------------------------------------------------------------- the process -- */

let child = null;

/**
 * Start the Python model service inside this container.
 *
 * Only when ROLES includes `infer` AND INFER_URL still points at loopback. Pointing
 * INFER_URL at a remote box and also spawning a local copy would load a second set
 * of weights into memory that nothing ever calls, which on a 2GB container is the
 * difference between running and being OOM-killed.
 */
export function startInfer() {
  if (!config.infer.spawn) return null;
  if (!config.roles.includes('infer')) return null;
  if (!/(127\.0\.0\.1|localhost)/.test(config.infer.url)) {
    console.log(`[infer] INFER_URL is remote (${config.infer.url}); not spawning a local model`);
    return null;
  }

  console.log(`[infer] starting model service on :${config.infer.port}`);
  child = spawn(
    'uvicorn',
    ['server:app', '--host', '127.0.0.1', '--port', String(config.infer.port), '--workers', '1'],
    {
      cwd: new URL('../../../infer/', import.meta.url).pathname,
      env: { ...process.env, INFER_MODEL: config.infer.model },
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );

  child.on('exit', (code, signal) => {
    // Loud, because a web container whose model died answers every cutout with a
    // connection refused that looks like a bug in the upload handler.
    console.error(`[infer] model service exited code=${code} signal=${signal}`);
    child = null;
  });

  return child;
}

export function stopInfer() {
  child?.kill('SIGTERM');
  child = null;
}

/**
 * Wait until the model answers, or give up.
 *
 * Called before the web server starts listening so the Railway healthcheck cannot
 * pass while the model is still loading weights. `healthcheckTimeout` in railway.json
 * is set well above this for the same reason.
 */
export async function waitForInfer({ timeoutMs = 180_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'never answered';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${config.infer.url}/healthz`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
      lastError = `status ${res.status}`;
    } catch (err) {
      lastError = err?.message ?? String(err);
    }
    await Bun.sleep(1000);
  }
  console.error(`[infer] model not ready after ${timeoutMs}ms: ${lastError}`);
  return false;
}

/* ------------------------------------------------------------------- calling -- */

export class CutoutError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

/**
 * Run one cutout.
 *
 * @param {object} args
 * @param {Blob|File} args.file       the uploaded image
 * @param {string} [args.model]
 * @param {number} [args.maxEdge]     0 means "as large as the service allows"
 * @returns {Promise<{png: ArrayBuffer, meta: object}>}
 */
export async function cutout({ file, model = config.infer.model, maxEdge = 0 }) {
  const form = new FormData();
  form.append('file', file, file.name ?? 'upload');
  form.append('model', model);
  form.append('max_edge', String(maxEdge));

  let res;
  try {
    res = await fetch(`${config.infer.url}/cutout`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(config.infer.timeoutMs),
    });
  } catch (err) {
    throw new CutoutError(`model service unreachable: ${err?.message ?? err}`, 503);
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    // 4xx from the model is the caller's fault (unreadable file, too big) and must be
    // passed through as such -- answering 502 makes a bad upload look like our outage.
    throw new CutoutError(detail || `model returned ${res.status}`, res.status < 500 ? 400 : 502);
  }

  return {
    png: await res.arrayBuffer(),
    meta: {
      model: res.headers.get('x-cutout-model') ?? model,
      durationMs: Number(res.headers.get('x-cutout-ms') ?? 0),
      width: Number(res.headers.get('x-cutout-width') ?? 0),
      height: Number(res.headers.get('x-cutout-height') ?? 0),
      sourceWidth: Number(res.headers.get('x-source-width') ?? 0),
      sourceHeight: Number(res.headers.get('x-source-height') ?? 0),
    },
  };
}
