// Small in-memory fixed-window rate limiter for API route handlers.
// Not distributed — fine for a single Next.js server process. Resets on restart.

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

let lastPrune = Date.now();
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;

function pruneExpired(now: number) {
  for (const [key, bucket] of buckets) {
    // A bucket is stale once its window has fully elapsed twice over —
    // cheap heuristic, avoids tracking per-bucket windowMs.
    if (now - bucket.windowStart > 10 * 60 * 1000) {
      buckets.delete(key);
    }
  }
  lastPrune = now;
}

export interface RateLimitOptions {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the caller may retry (0 when allowed). */
  retryAfterMs: number;
}

/**
 * Fixed-window rate limit check. Call once per incoming request with a
 * caller-derived key (e.g. `login:${ip}`). Mutates internal state.
 */
export function rateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  if (now - lastPrune > PRUNE_INTERVAL_MS) {
    pruneExpired(now);
  }

  const existing = buckets.get(key);
  if (!existing || now - existing.windowStart >= opts.windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (existing.count < opts.limit) {
    existing.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  const retryAfterMs = Math.max(0, opts.windowMs - (now - existing.windowStart));
  return { allowed: false, retryAfterMs };
}

/** Best-effort client identifier from common proxy headers. */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  const real = headers.get('x-real-ip');
  if (real && real.trim()) return real.trim();
  return 'unknown';
}
