const PYTHON_WORKER_URL = process.env.PYTHON_WORKER_URL || 'http://127.0.0.1:8000';

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
