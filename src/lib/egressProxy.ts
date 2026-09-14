import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

/** Mirror file read by Python worker + BiB without DB access. Source of truth for proxies. */
export const EGRESS_PROXY_MIRROR_PATH = path.join(process.cwd(), 'data', 'egress-proxy.json');

export type EgressProxyEntry = {
  id: string;
  url: string;
  enabled: boolean;
  /** Last successful egress check */
  ip?: string | null;
  country?: string | null;
  countryCode?: string | null;
  lastCheckedAt?: string | null;
  lastError?: string | null;
};

/**
 * Accept:
 * - http(s)://user:pass@host:port
 * - host:port
 * - user:pass@host:port
 * - host:port:user:pass  (common vendor format)
 * Returns canonical http URL or null.
 */
export function normalizeEgressProxyUrl(raw?: string | null): string | null {
  let text = String(raw ?? '').trim();
  if (!text) return null;

  // host:port:user:pass  (IPv4 or hostname)
  const colonParts = text.split(':');
  if (
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text) &&
    !text.includes('@') &&
    colonParts.length >= 4
  ) {
    const password = colonParts.pop() as string;
    const username = colonParts.pop() as string;
    const port = colonParts.pop() as string;
    const host = colonParts.join(':'); // IPv6-safe-ish if ever needed
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

/** Hide password in UI (user:****@host:port). */
export function maskProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!u.username && !u.password) return url;
    const user = u.username ? decodeURIComponent(u.username) : '';
    const port = u.port ? `:${u.port}` : '';
    return `${u.protocol}//${user ? `${user}:****@` : ''}${u.hostname}${port}`;
  } catch {
    return url.replace(/:([^:@/]+)@/, ':****@');
  }
}

export function normalizeEgressProxyList(raw: unknown): EgressProxyEntry[] {
  const out: EgressProxyEntry[] = [];
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const url = normalizeEgressProxyUrl(typeof row.url === 'string' ? row.url : null);
    if (!url) continue;
    out.push({
      id: typeof row.id === 'string' && row.id ? row.id : randomUUID(),
      url,
      enabled: row.enabled !== false,
      ip: typeof row.ip === 'string' ? row.ip : row.ip === null ? null : undefined,
      country: typeof row.country === 'string' ? row.country : row.country === null ? null : undefined,
      countryCode:
        typeof row.countryCode === 'string'
          ? row.countryCode
          : row.countryCode === null
            ? null
            : undefined,
      lastCheckedAt:
        typeof row.lastCheckedAt === 'string'
          ? row.lastCheckedAt
          : row.lastCheckedAt === null
            ? null
            : undefined,
      lastError:
        typeof row.lastError === 'string' ? row.lastError : row.lastError === null ? null : undefined,
    });
  }
  return out;
}

/** First enabled proxy URL (workers use this). */
export function activeEgressProxyUrl(proxies: EgressProxyEntry[]): string | null {
  const hit = proxies.find((p) => p.enabled && p.url);
  return hit?.url || null;
}

/**
 * Move active proxy to the next enabled entry (wrap). Keeps all entries enabled;
 * reorders so the next one is first among enabled.
 */
export function rotateActiveEgressProxy(): {
  ok: boolean;
  from: string | null;
  to: string | null;
  proxies: EgressProxyEntry[];
} {
  const { proxies } = readEgressProxyMirror();
  const enabled = proxies.filter((p) => p.enabled && p.url);
  if (enabled.length < 2) {
    return {
      ok: false,
      from: activeEgressProxyUrl(proxies),
      to: activeEgressProxyUrl(proxies),
      proxies,
    };
  }
  const from = enabled[0].url;
  // Rotate enabled order: [1,2,...,0] while preserving disabled entries in place after enabled block
  const enabledRotated = [...enabled.slice(1), enabled[0]];
  const disabled = proxies.filter((p) => !p.enabled || !p.url);
  const next = [...enabledRotated, ...disabled];
  writeEgressProxyMirror(next);
  return {
    ok: true,
    from,
    to: activeEgressProxyUrl(next),
    proxies: next,
  };
}

export function writeEgressProxyMirror(
  proxies: EgressProxyEntry[],
  assignments?: Record<string, string>
): void {
  const dir = path.dirname(EGRESS_PROXY_MIRROR_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const prev = readEgressProxyMirror();
  const url = activeEgressProxyUrl(proxies) || '';
  const nextAssignments =
    assignments !== undefined ? { ...assignments } : { ...prev.assignments };
  // Drop assignments pointing at removed proxy ids
  const ids = new Set(proxies.filter((p) => p.enabled && p.url).map((p) => p.id));
  for (const [acc, pid] of Object.entries(nextAssignments)) {
    if (!ids.has(pid)) delete nextAssignments[acc];
  }
  fs.writeFileSync(
    EGRESS_PROXY_MIRROR_PATH,
    JSON.stringify(
      {
        url,
        proxies,
        assignments: nextAssignments,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    'utf8'
  );
}

export function readEgressProxyMirror(): {
  url: string | null;
  proxies: EgressProxyEntry[];
  assignments: Record<string, string>;
} {
  try {
    if (!fs.existsSync(EGRESS_PROXY_MIRROR_PATH)) {
      return { url: null, proxies: [], assignments: {} };
    }
    const raw = JSON.parse(fs.readFileSync(EGRESS_PROXY_MIRROR_PATH, 'utf8'));
    const proxies = normalizeEgressProxyList(raw?.proxies);
    if (!proxies.length && raw?.url) {
      const url = normalizeEgressProxyUrl(raw.url);
      if (url) proxies.push({ id: 'legacy', url, enabled: true });
    }
    const assignments: Record<string, string> = {};
    if (raw?.assignments && typeof raw.assignments === 'object') {
      for (const [k, v] of Object.entries(raw.assignments)) {
        if (typeof k === 'string' && typeof v === 'string' && k && v) {
          assignments[k] = v;
        }
      }
    }
    return { url: activeEgressProxyUrl(proxies), proxies, assignments };
  } catch {
    return { url: null, proxies: [], assignments: {} };
  }
}

/** Proxy URL assigned to a BiB account (unique when enough proxies exist). */
export function getProxyUrlForAccount(accountId: string): string | null {
  if (!accountId) return activeEgressProxyUrl(readEgressProxyMirror().proxies);
  const { proxies, assignments } = readEgressProxyMirror();
  const enabled = proxies.filter((p) => p.enabled && p.url);
  if (!enabled.length) return null;
  const pid = assignments[accountId];
  const hit = pid ? enabled.find((p) => p.id === pid) : null;
  return hit?.url || null;
}

/**
 * Assign a unique enabled proxy to this account (prefer unused).
 * If more accounts than proxies, reuses the least-used proxy.
 */
export function ensureUniqueProxyForAccount(accountId: string): {
  url: string | null;
  proxyId: string | null;
  reused: boolean;
} {
  if (!accountId) return { url: null, proxyId: null, reused: false };
  const { proxies, assignments } = readEgressProxyMirror();
  const enabled = proxies.filter((p) => p.enabled && p.url);
  if (!enabled.length) return { url: null, proxyId: null, reused: false };

  const existing = assignments[accountId];
  if (existing) {
    const hit = enabled.find((p) => p.id === existing);
    if (hit) return { url: hit.url, proxyId: hit.id, reused: false };
  }

  const usedCounts = new Map<string, number>();
  for (const p of enabled) usedCounts.set(p.id, 0);
  for (const [acc, pid] of Object.entries(assignments)) {
    if (acc === accountId) continue;
    if (usedCounts.has(pid)) usedCounts.set(pid, (usedCounts.get(pid) || 0) + 1);
  }

  const unused = enabled.find((p) => (usedCounts.get(p.id) || 0) === 0);
  let pick = unused || null;
  let reused = false;
  if (!pick) {
    reused = true;
    pick = [...enabled].sort(
      (a, b) => (usedCounts.get(a.id) || 0) - (usedCounts.get(b.id) || 0)
    )[0];
  }

  const next = { ...assignments, [accountId]: pick.id };
  writeEgressProxyMirror(proxies, next);
  return { url: pick.url, proxyId: pick.id, reused };
}

/**
 * Move this account to the next enabled proxy (prefer one not used by others).
 */
export function rotateProxyForAccount(accountId: string): {
  ok: boolean;
  from: string | null;
  to: string | null;
  proxyId: string | null;
  error?: string;
} {
  if (!accountId) {
    return { ok: false, from: null, to: null, proxyId: null, error: 'accountId required' };
  }
  const { proxies, assignments } = readEgressProxyMirror();
  const enabled = proxies.filter((p) => p.enabled && p.url);
  if (enabled.length < 2) {
    const only = enabled[0] || null;
    return {
      ok: false,
      from: only?.url || null,
      to: only?.url || null,
      proxyId: only?.id || null,
      error: 'Need ≥2 enabled proxies to rotate',
    };
  }

  const curId = assignments[accountId] || enabled[0].id;
  const curIdx = Math.max(
    0,
    enabled.findIndex((p) => p.id === curId)
  );
  const from = enabled[curIdx]?.url || null;

  const usedByOthers = new Set(
    Object.entries(assignments)
      .filter(([acc]) => acc !== accountId)
      .map(([, pid]) => pid)
  );

  // Prefer next unused proxy walking the ring
  let pick = enabled[(curIdx + 1) % enabled.length];
  for (let i = 1; i < enabled.length; i++) {
    const cand = enabled[(curIdx + i) % enabled.length];
    if (!usedByOthers.has(cand.id)) {
      pick = cand;
      break;
    }
  }

  writeEgressProxyMirror(proxies, { ...assignments, [accountId]: pick.id });
  return { ok: true, from, to: pick.url, proxyId: pick.id };
}

/**
 * Reassign every given account to a unique proxy (round-robin if short).
 * Used after manual global rotate / bulk relaunch.
 */
export function reassignUniqueProxies(accountIds: string[]): Record<string, string> {
  const { proxies } = readEgressProxyMirror();
  const enabled = proxies.filter((p) => p.enabled && p.url);
  const assignments: Record<string, string> = {};
  if (!enabled.length || !accountIds.length) {
    writeEgressProxyMirror(proxies, assignments);
    return assignments;
  }
  const ids = [...new Set(accountIds.filter(Boolean))];
  ids.forEach((acc, i) => {
    assignments[acc] = enabled[i % enabled.length].id;
  });
  writeEgressProxyMirror(proxies, assignments);
  return assignments;
}

/**
 * Fetch public IP + country via the given HTTP proxy (proves proxy works).
 * Uses curl only — avoids bundling optional packages like undici.
 */
export async function probeProxyEgress(proxyUrl: string): Promise<{
  ok: boolean;
  ip?: string;
  country?: string;
  countryCode?: string;
  error?: string;
}> {
  const normalized = normalizeEgressProxyUrl(proxyUrl);
  if (!normalized) {
    return { ok: false, error: 'Invalid proxy URL' };
  }

  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  async function curlJson(url: string): Promise<{ data: Record<string, unknown> | null; err?: string }> {
    try {
      const { stdout, stderr } = await execFileAsync(
        'curl',
        [
          '-sS',
          '-x',
          normalized!,
          '--max-time',
          '20',
          '-H',
          'Accept: application/json',
          '-H',
          'User-Agent: Flowbysk-ProxyCheck/1.0',
          url,
        ],
        { encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 }
      );
      const text = String(stdout || '').trim();
      if (!text) {
        return { data: null, err: String(stderr || 'empty response').slice(0, 160) };
      }
      return { data: JSON.parse(text) as Record<string, unknown> };
    } catch (e: any) {
      const msg = e?.stderr || e?.message || String(e);
      return { data: null, err: String(msg).slice(0, 200) };
    }
  }

  try {
    const first = await curlJson('https://ipapi.co/json/');
    const data = first.data;
    if (data && !data.error && data.ip) {
      return {
        ok: true,
        ip: String(data.ip),
        country: String(data.country_name || data.country || 'Unknown'),
        countryCode: String(data.country_code || data.country || ''),
      };
    }

    const second = await curlJson('https://api.ipify.org?format=json');
    if (second.data?.ip) {
      return { ok: true, ip: String(second.data.ip), country: 'Unknown', countryCode: '' };
    }

    return {
      ok: false,
      error:
        (data && data.reason ? String(data.reason) : null) ||
        second.err ||
        first.err ||
        'Proxy check failed (curl could not reach IP lookup through this proxy)',
    };
  } catch (e: any) {
    const msg = e?.cause?.message || e?.message || String(e);
    return { ok: false, error: msg.slice(0, 200) };
  }
}


