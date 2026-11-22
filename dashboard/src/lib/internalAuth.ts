import crypto from 'crypto';

/**
 * Shared secret used to authorize trusted local/internal callers (the Python
 * worker, flow-bib) hitting our `/api/internal/*` routes. No hardcoded
 * fallback — if this is unset, only the localhost dev allowance below applies.
 */
export function expectedInternalSecret(): string | null {
  return process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET || null;
}

/** Constant-time comparison; returns false (not throw) on length mismatch. */
export function safeSecretEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/** True when the request appears to originate from localhost/loopback. */
export function isLoopbackRequest(req: Request): boolean {
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const fwd = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();

  const isLocalHost =
    !host ||
    host === 'localhost' ||
    host.startsWith('localhost:') ||
    host === '127.0.0.1' ||
    host.startsWith('127.0.0.1:') ||
    host === '[::1]' ||
    host.startsWith('[::1]:');
  const isLocalFwd =
    !fwd ||
    fwd === '127.0.0.1' ||
    fwd === '::1' ||
    fwd.startsWith('127.') ||
    fwd === 'localhost';

  return isLocalHost && isLocalFwd;
}

/**
 * Authorize an internal request: either the `x-internal-secret` header
 * matches INTERNAL_API_SECRET/JWT_SECRET (constant-time compare), or the
 * request is loopback (dev convenience only — real deployments should always
 * set INTERNAL_API_SECRET). If no secret is configured and the request isn't
 * loopback, access is denied.
 */
export function isInternalRequestAllowed(req: Request): boolean {
  const expected = expectedInternalSecret();
  const header = (req.headers.get('x-internal-secret') || '').trim();

  if (expected && header && safeSecretEquals(header, expected)) {
    return true;
  }

  return isLoopbackRequest(req);
}
