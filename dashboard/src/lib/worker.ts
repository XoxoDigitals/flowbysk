const _rawPythonWorkerUrl = process.env.PYTHON_WORKER_URL || 'http://127.0.0.1:8000';
/** Misconfigured deploys often still point at old :5001 — remap to FastAPI :8000. */
const PYTHON_WORKER_URL = /:5001(?:\/|$)/.test(_rawPythonWorkerUrl)
  ? _rawPythonWorkerUrl.replace(':5001', ':8000')
  : _rawPythonWorkerUrl;
if (PYTHON_WORKER_URL !== _rawPythonWorkerUrl) {
  console.warn(
    `[worker] PYTHON_WORKER_URL remapped ${_rawPythonWorkerUrl} → ${PYTHON_WORKER_URL}`
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransientFetchError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  const name = err instanceof Error ? err.name : '';
  return /fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|network|Failed to fetch|socket hang up|AbortError|aborted|UND_ERR|timed out|TimeoutError/i.test(
    `${name} ${msg}`
  );
}

export type FetchWithRetryOpts = RequestInit & {
  /** Per-attempt timeout ms (default 20000). */
  timeoutMs?: number;
  /** Total attempts including first (default 3). */
  retries?: number;
  /** Base backoff ms between retries (default 400). */
  backoffMs?: number;
};

/**
 * fetch with AbortSignal timeout + retries on connection blips.
 * Does not retry non-2xx HTTP responses (caller handles those).
 */
export async function fetchWithRetry(
  url: string,
  init?: FetchWithRetryOpts
): Promise<Response> {
  const timeoutMs = init?.timeoutMs ?? 20_000;
  const retries = Math.max(1, init?.retries ?? 3);
  const backoffMs = init?.backoffMs ?? 400;
  const { timeoutMs: _t, retries: _r, backoffMs: _b, signal: outerSignal, ...rest } = init || {};

  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const onOuterAbort = () => ctrl.abort();
    if (outerSignal) {
      if (outerSignal.aborted) ctrl.abort();
      else outerSignal.addEventListener('abort', onOuterAbort, { once: true });
    }
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...rest, signal: ctrl.signal });
      clearTimeout(timer);
      if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);
      return res;
    } catch (err) {
      clearTimeout(timer);
      if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);
      lastErr = err;
      if (!isTransientFetchError(err) || attempt >= retries) {
        throw err;
      }
      await sleep(backoffMs * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'fetch failed'));
}

/** Map low-level fetch failures to an actionable Studio error. */
export function formatWorkerFetchError(
  err: unknown,
  opts?: { workerLabel?: string; workerUrl?: string }
): string {
  const msg = err instanceof Error ? err.message : String(err || '');
  if (isTransientFetchError(err) || /fetch failed|ECONNREFUSED|ECONNRESET/i.test(msg)) {
    const label = opts?.workerLabel || 'Python Flow worker';
    const url = opts?.workerUrl || PYTHON_WORKER_URL;
    return `${label} unreachable at ${url}. Start it, then retry.`;
  }
  return msg || 'Worker request failed';
}

/** Headers so FastAPI can tag StudioLog rows with the SaaS user + run. */
export function workerIdentityHeaders(session?: {
  userId?: string | null;
  email?: string | null;
  runId?: string | null;
} | null): Record<string, string> {
  const headers: Record<string, string> = {};
  if (session?.userId) headers['X-GFlow-User-Id'] = session.userId;
  if (session?.email) headers['X-GFlow-User-Email'] = session.email;
  if (session?.runId) headers['X-GFlow-Run-Id'] = session.runId;
  return headers;
}

export { PYTHON_WORKER_URL, isTransientFetchError };
