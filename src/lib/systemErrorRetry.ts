/**
 * Shared “System Error” detection + automatic retries before failing a generation.
 * Policy violations are NOT retried (user-facing rejection stays).
 *
 * Unusual activity / too-much-traffic:
 *   1) rotate THAT account’s DataImpulse sticky + hard-relaunch BiB Chrome
 *   2) retry once on the new proxy
 *   then throw (do not keep burning the same IP).
 */

import { isUnusualActivityError, rotateProxyAndRelaunchForAccount } from './unusualActivityProxyRotate';
import { recordProxyOutcome } from './dataimpulse';

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
    /RECAPTCHA|UNUSUAL_ACTIVITY|unusual\s*activity|USER_REQUESTS_THROTTLED|REQUESTS_THROTTLED|THROTTLED|batchexecute error e=4|\be=4\b|Bearer rejected|MODEL_ACCESS_DENIED|QUOTA|WORKER RETURNED|WORKER HTTP|INTERNAL SERVER|TIMEOUT|CDP|COOKIE|Insufficient|ECONNRESET|ETIMEDOUT|fetch failed|network|not ready|mediaId|browser not launched|mint failed/i.test(
      text
    )
  ) {
    return true;
  }
  // Anything that is not an explicit policy rejection is treated as system.
  return true;
}

/** Google rate-limit / throttle — use a longer backoff before retry. */
export function isThrottleGenerationError(raw: unknown): boolean {
  return /USER_REQUESTS_THROTTLED|REQUESTS_THROTTLED|PUBLIC_ERROR_USER_REQUESTS_THROTTLED|THROTTLED|batchexecute error e=4|\be\s*=\s*4\b/i.test(
    String(raw ?? '')
  );
}

export type SystemRetryOptions = {
  delayMs?: number;
  /** @deprecated Prefer throttleDelaysMs — single wait applied to every throttle retry. */
  throttleDelayMs?: number;
  /** Waits after each throttle failure before the next attempt. Default [10000, 20000]. */
  throttleDelaysMs?: number[];
  /** Total attempts including the first for normal system errors (default 5). */
  maxAttempts?: number;
  label?: string;
  /** Provider account id — required for per-account unusual proxy rotate. */
  providerAccountId?: string;
  /** Job id — excluded from sibling count when rotating (safe relaunch gate). */
  jobId?: string;
  /** Called before each retry attempt (after the first failure). */
  onRetry?: (err: unknown, attempt: number) => void | Promise<void>;
  /** If returns false, skip the automatic retry (e.g. user cancelled). */
  shouldContinue?: () => boolean | Promise<boolean>;
};

/**
 * Run `fn`. On system-class errors, retry up to maxAttempts-1 more times.
 * Policy errors propagate immediately.
 * Unusual: rotate account proxy + relaunch → retry → then fail.
 * Throttle: wait 10s then 20s (default), then stop — no endless throttle retries.
 */
export async function withSystemErrorRetry<T>(
  fn: () => Promise<T>,
  opts: SystemRetryOptions = {}
): Promise<T> {
  const delayMs = opts.delayMs ?? 2500;
  const throttleDelaysMs =
    Array.isArray(opts.throttleDelaysMs) && opts.throttleDelaysMs.length
      ? opts.throttleDelaysMs.map((n) => Math.max(0, Number(n) || 0))
      : opts.throttleDelayMs != null
        ? [Math.max(0, Number(opts.throttleDelayMs) || 10000)]
        : [10000, 20000];
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 5);
  const label = opts.label || 'generation';

  let lastErr: unknown;
  let unusualHits = 0;
  let normalAttempts = 0;
  let throttleAttempts = 0;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/stop by user|cancelled by user/i.test(msg)) throw err;
      if (!isSystemGenerationError(msg)) throw err;

      if (opts.shouldContinue && !(await opts.shouldContinue())) {
        throw err;
      }

      // Dead egress / tunnel — rotate with deadTunnel so relaunch is allowed even with siblings
      if (/Egress proxy dead|ERR_TUNNEL|tunnel connection failed|no exit IP/i.test(msg)) {
        unusualHits += 1;
        if (opts.providerAccountId && unusualHits <= 2) {
          try {
            const rot = await rotateProxyAndRelaunchForAccount(opts.providerAccountId, {
              reason: 'egress proxy dead',
              exceptJobId: opts.jobId,
              deadTunnel: true,
              forceRelaunch: true,
            });
            console.warn(
              `[system-retry] ${label}: dead-proxy rotate ${rot.rotated ? 'ok' : 'skip'} relaunched=${rot.relaunched}`
            );
          } catch (e) {
            console.warn(`[system-retry] ${label}: dead-proxy rotate failed:`, e);
          }
          if (opts.onRetry) await opts.onRetry(err, unusualHits);
          await new Promise((r) => setTimeout(r, Math.max(delayMs, 4000)));
          continue;
        }
        break;
      }

      // Unusual / too-much-traffic: rotate sticky + hard-relaunch Chrome on first hit
      // (retrying the same burned IP never helps; deferred relaunch left Chrome on old proxy).
      if (isUnusualActivityError(msg)) {
        unusualHits += 1;
        try {
          recordProxyOutcome({
            event: 'unusual',
            accountId: opts.providerAccountId,
          });
        } catch {
          /* ignore */
        }
        console.warn(
          `[system-retry] ${label}: unusual #${unusualHits} — ${msg.slice(0, 160)}`
        );

        if (unusualHits <= 2) {
          if (opts.providerAccountId) {
            console.warn(
              `[system-retry] ${label}: rotating proxy for account ${opts.providerAccountId.slice(0, 8)} (hard relaunch)…`
            );
            try {
              const rot = await rotateProxyAndRelaunchForAccount(opts.providerAccountId, {
                reason: 'unusual activity',
                exceptJobId: opts.jobId,
                forceRelaunch: true,
                deadTunnel: /tunnel|egress proxy dead|ERR_TUNNEL|no exit IP/i.test(msg),
              });
              console.warn(
                `[system-retry] ${label}: proxy rotate ${rot.rotated ? 'ok' : 'skipped'} relaunched=${rot.relaunched}${
                  rot.deferred ? ' (deferred)' : ''
                } → ${rot.to || rot.error || 'n/a'}`
              );
            } catch (e) {
              console.warn(`[system-retry] ${label}: proxy rotate failed:`, e);
            }
          } else {
            console.warn(
              `[system-retry] ${label}: unusual #${unusualHits} but no providerAccountId — cannot rotate`
            );
          }
          if (opts.onRetry) await opts.onRetry(err, unusualHits);
          await new Promise((r) => setTimeout(r, Math.max(delayMs, 4000)));
          if (opts.shouldContinue && !(await opts.shouldContinue())) {
            throw new Error('Stop by user');
          }
          continue;
        }

        // unusualHits >= 3 → give up
        break;
      }

      // Throttle: fixed schedule (default 10s then 20s), then stop
      if (isThrottleGenerationError(msg)) {
        throttleAttempts += 1;
        try {
          recordProxyOutcome({
            event: 'throttle',
            accountId: opts.providerAccountId,
          });
        } catch {
          /* ignore */
        }
        if (throttleAttempts > throttleDelaysMs.length) {
          console.warn(
            `[system-retry] ${label}: throttle retries exhausted (${throttleAttempts - 1}/${throttleDelaysMs.length}) — giving up`
          );
          break;
        }
        const waitMs = throttleDelaysMs[throttleAttempts - 1] ?? 10000;
        console.warn(
          `[system-retry] ${label}: throttle attempt ${throttleAttempts}/${throttleDelaysMs.length} failed — ${msg.slice(0, 180)}; retrying in ${waitMs}ms…`
        );
        if (opts.onRetry) await opts.onRetry(err, throttleAttempts);
        if (opts.shouldContinue && !(await opts.shouldContinue())) {
          throw new Error('Stop by user');
        }
        await new Promise((r) => setTimeout(r, waitMs));
        if (opts.shouldContinue && !(await opts.shouldContinue())) {
          throw new Error('Stop by user');
        }
        continue;
      }

      // Normal system errors
      normalAttempts += 1;
      if (normalAttempts >= maxAttempts) break;

      const waitMs = delayMs;
      console.warn(
        `[system-retry] ${label}: attempt ${normalAttempts}/${maxAttempts} failed — ${msg.slice(0, 180)}; retrying in ${waitMs}ms…`
      );
      if (opts.onRetry) await opts.onRetry(err, normalAttempts);
      if (opts.shouldContinue && !(await opts.shouldContinue())) {
        throw new Error('Stop by user');
      }
      await new Promise((r) => setTimeout(r, waitMs));
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
