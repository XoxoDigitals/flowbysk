/**
 * IP → country lookup with in-memory cache.
 * Prefer real client headers when behind nginx / Cloudflare. Fail-open to XX.
 */
const cache = new Map(); // ip -> { country, at }
const TTL_MS = 24 * 60 * 60 * 1000;

function normalizeIp(ip) {
  let s = String(ip || '').trim();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  if (s === '::1') s = '127.0.0.1';
  if (s.includes(',')) s = s.split(',')[0].trim();
  // Strip surrounding brackets / ports for IPv6 literals rarely seen in headers
  if (s.startsWith('[') && s.includes(']')) s = s.slice(1, s.indexOf(']'));
  return s;
}

function isPrivate(ip) {
  const s = normalizeIp(ip);
  return (
    !s ||
    s === '127.0.0.1' ||
    s === '0.0.0.0' ||
    s.startsWith('10.') ||
    s.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(s) ||
    s.startsWith('fc') ||
    s.startsWith('fd') ||
    s === 'localhost'
  );
}

function headerFirst(val) {
  if (Array.isArray(val)) return String(val[0] || '').trim();
  if (typeof val === 'string') return val.trim();
  return '';
}

function splitIpList(raw) {
  return String(raw || '')
    .split(',')
    .map((p) => normalizeIp(p))
    .filter(Boolean);
}

/** First public IP in a candidate list; else first private; else ''. */
function pickBestIp(candidates) {
  const list = candidates.map(normalizeIp).filter(Boolean);
  const pub = list.find((ip) => !isPrivate(ip));
  if (pub) return pub;
  return list[0] || '';
}

/**
 * Real client IP behind Cloudflare / nginx.
 * Order: CF-Connecting-IP → True-Client-IP → X-Real-IP → public XFF hop → req.ip
 */
function clientIpFromReq(req) {
  const h = req?.headers || {};
  const candidates = [];

  const cf = headerFirst(h['cf-connecting-ip']);
  if (cf) candidates.push(cf);

  const trueClient = headerFirst(h['true-client-ip']);
  if (trueClient) candidates.push(trueClient);

  const xReal = headerFirst(h['x-real-ip']);
  if (xReal) candidates.push(...splitIpList(xReal));

  const xff = headerFirst(h['x-forwarded-for']);
  if (xff) candidates.push(...splitIpList(xff));

  // Express trust-proxy resolved IP (may still be loopback if headers missing)
  if (req?.ip) candidates.push(req.ip);
  if (req?.socket?.remoteAddress) candidates.push(req.socket.remoteAddress);

  return pickBestIp(candidates);
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

/** Attach ip + country for activity logs (fail-open). */
async function requestGeo(req) {
  const ip = clientIpFromReq(req);
  const country = await lookupCountry(ip);
  return { ip, country };
}

module.exports = {
  lookupCountry,
  normalizeIp,
  clientIpFromReq,
  isPrivate,
  requestGeo,
};
