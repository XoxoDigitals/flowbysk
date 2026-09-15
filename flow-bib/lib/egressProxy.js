'use strict';

const fs = require('fs');
const path = require('path');

const MIRROR_FILE = path.resolve(__dirname, '..', '..', 'data', 'egress-proxy.json');
const NEXT_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_URL || 'http://127.0.0.1:3100';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET || '';

let _cache = { key: '', url: null, at: 0 };

/**
 * Accept:
 * - http(s)://user:pass@host:port
 * - host:port
 * - user:pass@host:port
 * - host:port:user:pass
 * @returns {string|null}
 */
function normalizeProxyUrl(raw) {
  let text = String(raw || '').trim();
  if (!text) return null;

  const colonParts = text.split(':');
  if (
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text) &&
    !text.includes('@') &&
    colonParts.length >= 4
  ) {
    const password = colonParts.pop();
    const username = colonParts.pop();
    const port = colonParts.pop();
    const host = colonParts.join(':');
    if (host && /^\d+$/.test(port) && username) {
      text = `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`;
    }
  }

  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text)) {
    text = `http://${text}`;
  }
  try {
    const u = new URL(text);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    const auth =
      u.username || u.password
        ? `${encodeURIComponent(decodeURIComponent(u.username))}${
            u.password ? `:${encodeURIComponent(decodeURIComponent(u.password))}` : ''
          }@`
        : '';
    const port = u.port ? `:${u.port}` : '';
    return `${u.protocol}//${auth}${u.hostname}${port}`;
  } catch {
    return null;
  }
}

function enabledProxies(raw) {
  const list = [];
  if (!raw || typeof raw !== 'object') return list;
  if (Array.isArray(raw.proxies)) {
    for (const p of raw.proxies) {
      if (!p || p.enabled === false) continue;
      const url = normalizeProxyUrl(p.url);
      if (!url) continue;
      list.push({
        id: typeof p.id === 'string' && p.id ? p.id : `p${list.length}`,
        url,
      });
    }
  }
  if (!list.length) {
    const url = normalizeProxyUrl(raw.url);
    if (url) list.push({ id: 'legacy', url });
  }
  return list;
}

function readMirrorFile() {
  try {
    if (!fs.existsSync(MIRROR_FILE)) return null;
    return JSON.parse(fs.readFileSync(MIRROR_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeMirrorFile(raw) {
  try {
    fs.mkdirSync(path.dirname(MIRROR_FILE), { recursive: true });
    fs.writeFileSync(
      MIRROR_FILE,
      JSON.stringify({ ...raw, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
  } catch (e) {
    console.warn('[egress-proxy] write mirror failed:', e.message);
  }
}

function activeFromMirror(raw) {
  const enabled = enabledProxies(raw);
  return enabled[0]?.url || null;
}

function readMirror() {
  return activeFromMirror(readMirrorFile());
}

/**
 * Assign / return a unique proxy for this BiB account.
 * Prefers unused proxies; if short, reuses least-used.
 */
function ensureAccountProxy(accountId, { forceNew = false } = {}) {
  if (!accountId) return readMirror();
  const raw = readMirrorFile() || { proxies: [], assignments: {} };
  const enabled = enabledProxies(raw);
  if (!enabled.length) return null;

  const assignments =
    raw.assignments && typeof raw.assignments === 'object' ? { ...raw.assignments } : {};

  const existingId = assignments[accountId];
  if (existingId && !forceNew) {
    const hit = enabled.find((p) => p.id === existingId);
    if (hit) return hit.url;
  }

  const usedCounts = new Map(enabled.map((p) => [p.id, 0]));
  for (const [acc, pid] of Object.entries(assignments)) {
    if (acc === accountId) continue;
    if (usedCounts.has(pid)) usedCounts.set(pid, (usedCounts.get(pid) || 0) + 1);
  }

  // When forcing a new proxy (dead tunnel), prefer next unused / different id
  let pick = null;
  if (forceNew && existingId && enabled.length > 1) {
    const curIdx = Math.max(0, enabled.findIndex((p) => p.id === existingId));
    for (let i = 1; i < enabled.length; i++) {
      const cand = enabled[(curIdx + i) % enabled.length];
      if ((usedCounts.get(cand.id) || 0) === 0) {
        pick = cand;
        break;
      }
    }
    if (!pick) pick = enabled[(curIdx + 1) % enabled.length];
  }

  if (!pick) {
    pick = enabled.find((p) => (usedCounts.get(p.id) || 0) === 0);
  }
  if (!pick) {
    pick = [...enabled].sort(
      (a, b) => (usedCounts.get(a.id) || 0) - (usedCounts.get(b.id) || 0)
    )[0];
    console.warn(
      `[egress-proxy] not enough unique proxies — reusing ${pick.id} for account ${accountId.slice(0, 8)} (add more proxies)`
    );
  } else {
    console.log(
      `[egress-proxy] assigned ${forceNew ? 'rotated' : 'unique'} proxy ${pick.id} → account ${accountId.slice(0, 8)}`
    );
  }

  assignments[accountId] = pick.id;
  const proxies = Array.isArray(raw.proxies) ? raw.proxies : enabled;
  writeMirrorFile({
    url: activeFromMirror({ proxies: enabled }),
    proxies,
    assignments,
  });
  return pick.url;
}

function rotateAccountProxy(accountId) {
  return ensureAccountProxy(accountId, { forceNew: true });
}

function clearEgressProxyCache() {
  _cache = { key: '', url: null, at: 0 };
}

/**
 * Resolve egress proxy for an account (unique when possible).
 * Mirror assignments → mirror active → env → Next internal API.
 * @returns {Promise<string|null>}
 */
async function resolveEgressProxyUrl(opts = {}) {
  const force = !!(opts && opts.force);
  const accountId = opts && opts.accountId ? String(opts.accountId) : '';
  const cacheKey = accountId || '__default__';
  const now = Date.now();
  if (!force && _cache.key === cacheKey && now - _cache.at < 5000 && _cache.url !== undefined) {
    return _cache.url;
  }

  let url = null;
  if (accountId) {
    url = ensureAccountProxy(accountId);
  }
  if (!url) url = readMirror();
  if (!url) url = normalizeProxyUrl(process.env.EGRESS_PROXY_URL);

  if (!url) {
    try {
      const r = await fetch(`${NEXT_URL.replace(/\/$/, '')}/api/internal/egress-proxy`, {
        headers: INTERNAL_SECRET ? { 'x-internal-secret': INTERNAL_SECRET } : {},
      });
      if (r.ok) {
        const data = await r.json().catch(() => null);
        url = normalizeProxyUrl(data && data.url);
        if (!url && data && Array.isArray(data.proxies)) {
          for (const p of data.proxies) {
            if (p && p.enabled !== false) {
              url = normalizeProxyUrl(p.url);
              if (url) break;
            }
          }
        }
      }
    } catch {
      /* app unreachable */
    }
  }

  _cache = { key: cacheKey, url, at: now };
  return url;
}

/**
 * Parse proxy URL for Chrome --proxy-server + page.authenticate.
 * @param {string} proxyUrl
 * @returns {{ server: string, username?: string, password?: string }}
 */
function parseProxyForChrome(proxyUrl) {
  const u = new URL(proxyUrl);
  const server = `${u.protocol}//${u.hostname}${u.port ? `:${u.port}` : ''}`;
  const username = u.username ? decodeURIComponent(u.username) : '';
  const password = u.password ? decodeURIComponent(u.password) : '';
  return {
    server,
    ...(username ? { username, password } : {}),
  };
}

module.exports = {
  resolveEgressProxyUrl,
  parseProxyForChrome,
  normalizeProxyUrl,
  readMirror,
  ensureAccountProxy,
  rotateAccountProxy,
  clearEgressProxyCache,
};
