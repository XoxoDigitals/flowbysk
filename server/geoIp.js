/**
 * IP → country lookup with in-memory cache.
 * Providers: ipinfo.io → ip-api.com → ipwho.is (fail-open to XX).
 * Prefer real client headers when behind nginx / Cloudflare.
 */
const cache = new Map(); // ip -> { country, at }
const TTL_MS = 24 * 60 * 60 * 1000;

function normalizeIp(ip) {
  let s = String(ip || '').trim();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  if (s === '::1') s = '127.0.0.1';
  if (s.includes(',')) s = s.split(',')[0].trim();
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

function pickBestIp(candidates) {
  const list = candidates.map(normalizeIp).filter(Boolean);
  const pub = list.find((ip) => !isPrivate(ip));
  if (pub) return pub;
  return list[0] || '';
}

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

  if (req?.ip) candidates.push(req.ip);
  if (req?.socket?.remoteAddress) candidates.push(req.socket.remoteAddress);

  return pickBestIp(candidates);
}

function parseCountryCode(raw) {
  const s = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return /^[A-Z]{2}$/.test(s) ? s : null;
}

async function fetchText(url, headers = {}, ms = 2500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    const text = await res.text();
    if (!res.ok) return null;
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchJson(url, headers = {}, ms = 2500) {
  const text = await fetchText(url, { Accept: 'application/json', ...headers }, ms);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** ipinfo.io — optional IPINFO_TOKEN for higher limits. */
async function lookupViaIpinfo(ip) {
  const token = String(process.env.IPINFO_TOKEN || '').trim();
  const auth = token ? `?token=${encodeURIComponent(token)}` : '';
  // Plain country endpoint
  const plain = await fetchText(`https://ipinfo.io/${encodeURIComponent(ip)}/country${auth}`, {
    Accept: 'text/plain',
  });
  const fromPlain = parseCountryCode(plain);
  if (fromPlain) return fromPlain;

  const json = await fetchJson(`https://ipinfo.io/${encodeURIComponent(ip)}/json${auth}`);
  return parseCountryCode(json?.country);
}

/** ip-api.com free (HTTP) — no key required. */
async function lookupViaIpApi(ip) {
  const json = await fetchJson(
    `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode`
  );
  if (!json || json.status !== 'success') return null;
  return parseCountryCode(json.countryCode);
}

/** ipwho.is free HTTPS fallback. */
async function lookupViaIpWho(ip) {
  const json = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`);
  if (!json || json.success === false) return null;
  return parseCountryCode(json.country_code || json.countryCode);
}

async function lookupCountry(ip) {
  const key = normalizeIp(ip);
  if (isPrivate(key)) return 'LOCAL';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.country;

  let country = null;
  try {
    country = await lookupViaIpinfo(key);
  } catch {
    country = null;
  }
  if (!country) {
    try {
      country = await lookupViaIpApi(key);
    } catch {
      country = null;
    }
  }
  if (!country) {
    try {
      country = await lookupViaIpWho(key);
    } catch {
      country = null;
    }
  }

  const out = country || 'XX';
  cache.set(key, { country: out, at: Date.now() });
  return out;
}

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
