'use strict';

const fs = require('fs');
const path = require('path');

const MIRROR_FILE = path.resolve(__dirname, '..', '..', 'data', 'egress-proxy.json');
const NEXT_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_URL || 'http://127.0.0.1:3100';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET || '';

let _cache = { key: '', url: null, at: 0 };
/** Serialize assignment writes so concurrent launches do not collide. */
let _assignChain = Promise.resolve();

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

function normalizeCycleUsed(raw, enabled) {
  const enabledIds = new Set(enabled.map((p) => p.id));
  const out = [];
  if (Array.isArray(raw)) {
    for (const id of raw) {
      if (typeof id === 'string' && enabledIds.has(id) && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/**
 * Next proxy in list order not held by another account and not yet used this cycle.
 * When every enabled proxy has been used once, cycle resets and starts again.
 */
function pickNextPoolProxy(enabled, assignments, cycleUsedIn, accountId, opts = {}) {
  if (!enabled.length) return { pick: null, cycleUsed: [] };

  const heldByOthers = new Set(
    Object.entries(assignments)
      .filter(([acc]) => acc !== accountId)
      .map(([, pid]) => pid)
  );

  let cycle = new Set(normalizeCycleUsed(cycleUsedIn, enabled));
  const forceNew = !!opts.forceNew;
  const startAfterId = opts.startAfterId || null;

  const resetCycle = () => {
    cycle = new Set(heldByOthers);
    if (forceNew && startAfterId) cycle.add(startAfterId);
  };

  const tryPick = () => {
    const startIdx = startAfterId
      ? Math.max(0, enabled.findIndex((p) => p.id === startAfterId))
      : -1;
    for (let i = 1; i <= enabled.length; i++) {
      const cand = enabled[(startIdx + i + enabled.length) % enabled.length];
      if (forceNew && cand.id === startAfterId) continue;
      if (heldByOthers.has(cand.id)) continue;
      if (cycle.has(cand.id)) continue;
      return cand;
    }
    return null;
  };

  if (enabled.every((p) => cycle.has(p.id))) resetCycle();

  let pick = tryPick();
  if (!pick) {
    resetCycle();
    pick = tryPick();
  }
  if (!pick) {
    const counts = new Map(enabled.map((p) => [p.id, 0]));
    for (const pid of heldByOthers) {
      if (counts.has(pid)) counts.set(pid, (counts.get(pid) || 0) + 1);
    }
    pick =
      [...enabled]
        .filter((p) => !forceNew || p.id !== startAfterId)
        .sort((a, b) => (counts.get(a.id) || 0) - (counts.get(b.id) || 0))[0] || null;
  }

  if (pick) cycle.add(pick.id);
  return { pick, cycleUsed: [...cycle] };
}

/**
 * Assign / return sticky proxy for this BiB account.
 * Pool cycle: a used proxy is not given to another account until the full pool
 * has been consumed once, then the cycle starts again.
 */
function ensureAccountProxySync(accountId, { forceNew = false } = {}) {
  if (!accountId) return null;
  const raw = readMirrorFile() || { proxies: [], assignments: {}, cycleUsed: [] };
  const enabled = enabledProxies(raw);
  if (!enabled.length) return null;

  const assignments =
    raw.assignments && typeof raw.assignments === 'object' ? { ...raw.assignments } : {};
  let cycleUsed = normalizeCycleUsed(raw.cycleUsed, enabled);
  if (!cycleUsed.length) {
    for (const pid of Object.values(assignments)) {
      if (enabled.some((p) => p.id === pid) && !cycleUsed.includes(pid)) cycleUsed.push(pid);
    }
  }

  const existingId = assignments[accountId];
  if (existingId && !forceNew) {
    const hit = enabled.find((p) => p.id === existingId);
    if (hit) return hit.url;
  }

  const { pick, cycleUsed: nextCycle } = pickNextPoolProxy(
    enabled,
    assignments,
    cycleUsed,
    accountId,
    { forceNew, startAfterId: forceNew ? existingId || null : null }
  );
  if (!pick) return null;

  console.log(
    `[egress-proxy] assigned ${forceNew ? 'rotated' : 'unique'} proxy ${pick.id} → account ${accountId.slice(0, 8)} (cycle ${nextCycle.length}/${enabled.length})`
  );

  assignments[accountId] = pick.id;
  const proxies = Array.isArray(raw.proxies) ? raw.proxies : enabled;
  writeMirrorFile({
    url: activeFromMirror({ proxies: enabled }),
    proxies,
    assignments,
    cycleUsed: nextCycle,
  });
  return pick.url;
}

function ensureAccountProxy(accountId, opts = {}) {
  if (!accountId) return null;
  // Sync path is fine when called from a single-threaded await chain;
  // mutex below covers concurrent resolveEgressProxyUrl calls.
  return ensureAccountProxySync(accountId, opts);
}

function withAssignLock(fn) {
  const run = _assignChain.then(fn, fn);
  _assignChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function rotateAccountProxy(accountId) {
  return ensureAccountProxySync(accountId, { forceNew: true });
}

function clearEgressProxyCache() {
  _cache = { key: '', url: null, at: 0 };
}

/**
 * Resolve egress proxy for an account (sticky unique when accountId set).
 * With accountId: assignments only — never global first-proxy fallback.
 * Without accountId: mirror active → env → Next internal API.
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
    url = await withAssignLock(() => ensureAccountProxySync(accountId));
    // Per-account: do not fall back to global first proxy (that caused sharing).
    if (!url) url = normalizeProxyUrl(process.env.EGRESS_PROXY_URL);
    _cache = { key: cacheKey, url, at: Date.now() };
    return url;
  }

  url = readMirror();
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
