'use strict';

const fs = require('fs');
const path = require('path');

const MIRROR_FILE = path.resolve(__dirname, '..', '..', 'data', 'egress-proxy.json');
const NEXT_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_URL || 'http://127.0.0.1:3100';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET || '';

let _cache = { url: null, at: 0 };

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

function activeFromMirror(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (Array.isArray(raw.proxies)) {
    for (const p of raw.proxies) {
      if (p && p.enabled !== false) {
        const url = normalizeProxyUrl(p.url);
        if (url) return url;
      }
    }
  }
  return normalizeProxyUrl(raw.url);
}

function readMirror() {
  try {
    if (!fs.existsSync(MIRROR_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(MIRROR_FILE, 'utf8'));
    return activeFromMirror(raw);
  } catch {
    return null;
  }
}

function clearEgressProxyCache() {
  _cache = { url: null, at: 0 };
}

/**
 * Resolve egress proxy: EGRESS_PROXY_URL env → mirror file → Next internal API.
 * Cached for 30s.
 * @returns {Promise<string|null>}
 */
async function resolveEgressProxyUrl(opts = {}) {
  const force = !!(opts && opts.force);
  const now = Date.now();
  if (!force && now - _cache.at < 30000 && _cache.url !== undefined) {
    return _cache.url;
  }

  let url = normalizeProxyUrl(process.env.EGRESS_PROXY_URL);
  if (!url) url = readMirror();

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

  _cache = { url, at: now };
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
  clearEgressProxyCache,
};
