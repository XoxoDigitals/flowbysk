/**
 * Lightweight IP → country lookup with in-memory cache.
 * Uses ipapi.co JSON (no API key for low volume). Fail-open to XX.
 */
const cache = new Map(); // ip -> { country, at }
const TTL_MS = 24 * 60 * 60 * 1000;

function normalizeIp(ip) {
  let s = String(ip || '').trim();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  if (s === '::1') s = '127.0.0.1';
  return s;
}

function isPrivate(ip) {
  return (
    !ip ||
    ip === '127.0.0.1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

async function lookupCountry(ip) {
  const key = normalizeIp(ip);
  if (isPrivate(key)) return 'LOCAL';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.country;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(key)}/country/`, {
      signal: ctrl.signal,
      headers: { Accept: 'text/plain' },
    });
    clearTimeout(t);
    const text = (await res.text()).trim().toUpperCase();
    const country = /^[A-Z]{2}$/.test(text) ? text : 'XX';
    cache.set(key, { country, at: Date.now() });
    return country;
  } catch {
    cache.set(key, { country: 'XX', at: Date.now() });
    return 'XX';
  }
}

module.exports = { lookupCountry, normalizeIp };
