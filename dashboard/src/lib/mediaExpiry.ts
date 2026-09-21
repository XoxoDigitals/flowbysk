/**
 * Google Flow CDN URLs include an absolute unix Expires= query param.
 * Prefer that over the provisional DB expiresAt (often createdAt + 24h).
 */

export function parseExpiresFromMediaUrl(url: string | null | undefined): Date | null {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/[?&]Expires=(\d+)/i) || url.match(/[?&]expire(?:s)?=(\d+)/i);
  if (!match) return null;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  // Seconds vs milliseconds
  const ms = raw > 1e12 ? raw : raw * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function resolveMediaExpiresAt(
  url: string | null | undefined,
  dbExpires: Date | string | null | undefined
): Date | null {
  const fromUrl = parseExpiresFromMediaUrl(url);
  if (fromUrl) return fromUrl;
  if (dbExpires == null || dbExpires === '') return null;
  const d = dbExpires instanceof Date ? dbExpires : new Date(dbExpires);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Completed media whose CDN/DB clock is already past — hide from gallery. */
export function isCompletedMediaExpired(
  url: string | null | undefined,
  dbExpires: Date | string | null | undefined,
  now: Date = new Date()
): boolean {
  const exp = resolveMediaExpiresAt(url, dbExpires);
  if (!exp) return false;
  return exp.getTime() <= now.getTime();
}
