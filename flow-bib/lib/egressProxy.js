'use strict';

const fs = require('fs');
const path = require('path');

const MIRROR_FILE = path.resolve(__dirname, '..', '..', 'data', 'egress-proxy.json');
const NEXT_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_URL || 'http://127.0.0.1:3100';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET || '';

let _cache = { url: null, at: 0 };

/**
 * @returns {string|null}
 */
function normalizeProxyUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    const u = new URL(text);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return text;
  } catch {
    return null;
  }
}

function readMirror() {
  try {
    if (!fs.existsSync(MIRROR_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(MIRROR_FILE, 'utf8'));
    return normalizeProxyUrl(raw && raw.url);
  } catch {
    return null;
  }
}

/**
 * Resolve egress proxy: EGRESS_PROXY_URL env → mirror file → Next internal API.
 * Cached for 30s.
 * @returns {Promise<string|null>}
 */
async function resolveEgressProxyUrl() {
  const now = Date.now();
  if (now - _cache.at < 30000 && _cache.url !== undefined) {
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
};
