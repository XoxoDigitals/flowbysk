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

/** Map low-level fetch failures to an actionable Studio error. */
export function formatWorkerFetchError(
  err: unknown,
  opts?: { workerLabel?: string; workerUrl?: string }
): string {
  const msg = err instanceof Error ? err.message : String(err || '');
  if (
    /fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|network|Failed to fetch|socket hang up/i.test(
      msg
    )
  ) {
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

export { PYTHON_WORKER_URL };
