/**
 * Shared “System Error” detection + automatic retries before failing a generation.
 * Policy violations are NOT retried (user-facing rejection stays).
 */

export function isPolicyGenerationError(raw: unknown): boolean {
  const text = String(raw ?? '').trim();
  if (!text) return false;
  return (
    /POLICY\s*VIOLAT/i.test(text) ||
    /CONTENT[_\s-]?POLICY/i.test(text) ||
    /SAFETY[_\s-]?(FILTER|VIOLAT|BLOCK|CHECK)/i.test(text) ||
    /PUBLIC_ERROR_[A-Z0-9_]*?(UNSAFE|SAFETY|FILTER|BLOCKED|POLICY)/i.test(text) ||
    /\bRAI[_\s-]?(FILTER|BLOCK|VIOLAT|CATEGORY)/i.test(text) ||
    /FILTERED[_\s-]?(BY[_\s-]?)?(GOOGLE|SAFETY|POLICY)/i.test(text) ||
    /BLOCKED[_\s-]?(BY[_\s-]?)?(GOOGLE|SAFETY|POLICY)/i.test(text) ||
    /PROHIBITED[_\s-]?CONTENT/i.test(text) ||
    /RESPONSIBLE[_\s-]?AI/i.test(text) ||
    /violates?\s+(our\s+|google'?s?\s+)?polic/i.test(text) ||
    /unsafe\s+content/i.test(text) ||
    /not\s+allowed\s+by\s+(our\s+|google)/i.test(text) ||
    /Rejected by Google due to policy violation/i.test(text)
  );
}

/** Matches Studio’s user-facing “System Error” bucket (excludes policy). */
export function isSystemGenerationError(raw: unknown): boolean {
  const text = String(raw ?? '').trim();
  if (!text) return true;
  if (isPolicyGenerationError(text)) return false;
  if (
    /RECAPTCHA|UNUSUAL_ACTIVITY|unusual\s*activity|Bearer rejected|MODEL_ACCESS_DENIED|QUOTA|WORKER RETURNED|WORKER HTTP|INTERNAL SERVER|TIMEOUT|CDP|COOKIE|Insufficient|ECONNRESET|ETIMEDOUT|fetch failed|network|not ready|mediaId|browser not launched|mint failed/i.test(
      text
    )
  ) {
    return true;
  }
  // Anything that is not an explicit policy rejection is treated as system.
  return true;
}

export type SystemRetryOptions = {
  delayMs?: number;
  /** Total attempts including the first (default 5). */
  maxAttempts?: number;
  label?: string;
  /** Called before each retry attempt (after the first failure). */
  onRetry?: (err: unknown, attempt: number) => void | Promise<void>;
  /** If returns false, skip the automatic retry (e.g. user cancelled). */
  shouldContinue?: () => boolean | Promise<boolean>;
};

/**
 * Run `fn`. On system-class errors, retry up to maxAttempts-1 more times.
 * Policy errors propagate immediately.
 */
export async function withSystemErrorRetry<T>(
  fn: () => Promise<T>,
  opts: SystemRetryOptions = {}
): Promise<T> {
  const delayMs = opts.delayMs ?? 2500;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 5);
  const label = opts.label || 'generation';

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/stop by user|cancelled by user/i.test(msg)) throw err;
      if (!isSystemGenerationError(msg)) throw err;
      if (attempt >= maxAttempts) break;
      if (opts.shouldContinue && !(await opts.shouldContinue())) {
        throw err;
      }

      console.warn(
        `[system-retry] ${label}: attempt ${attempt}/${maxAttempts} failed — ${msg.slice(0, 180)}; retrying…`
      );
      if (opts.onRetry) await opts.onRetry(err, attempt);
      if (opts.shouldContinue && !(await opts.shouldContinue())) {
        throw new Error('Stop by user');
      }
      await new Promise((r) => setTimeout(r, delayMs));
      if (opts.shouldContinue && !(await opts.shouldContinue())) {
        throw new Error('Stop by user');
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'Generation failed'));
}

/** Fetch worker JSON with System Error retries (HTTP failures included). */
export async function fetchWorkerJsonWithSystemRetry(
  url: string,
  init: RequestInit,
  opts: SystemRetryOptions = {}
): Promise<any> {
  return withSystemErrorRetry(async () => {
    const res = await fetch(url, init);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Worker returned ${res.status}: ${errText.substring(0, 200)}`);
    }
    return res.json();
  }, opts);
}
