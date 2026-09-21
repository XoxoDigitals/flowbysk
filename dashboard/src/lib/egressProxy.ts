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
  assignments?: Record<string, string>,
  cycleUsed?: string[]
): void {
  const dir = path.dirname(EGRESS_PROXY_MIRROR_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const prev = readEgressProxyMirror();
  const url = activeEgressProxyUrl(proxies) || '';
  const nextAssignments =
    assignments !== undefined ? { ...assignments } : { ...prev.assignments };
  const enabledIds = new Set(proxies.filter((p) => p.enabled && p.url).map((p) => p.id));
  for (const [acc, pid] of Object.entries(nextAssignments)) {
    if (!enabledIds.has(pid)) delete nextAssignments[acc];
  }
  const rawCycle = cycleUsed !== undefined ? cycleUsed : prev.cycleUsed;
  const nextCycle = [
    ...new Set(
      (rawCycle || []).filter((id) => typeof id === 'string' && enabledIds.has(id))
    ),
  ];
  // Still-held proxies must stay marked used so vacated slots aren't reused mid-cycle
  for (const pid of Object.values(nextAssignments)) {
    if (enabledIds.has(pid) && !nextCycle.includes(pid)) nextCycle.push(pid);
  }
  fs.writeFileSync(
    EGRESS_PROXY_MIRROR_PATH,
    JSON.stringify(
      {
        url,
        proxies,
        assignments: nextAssignments,
        cycleUsed: nextCycle,
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
  /** Proxy ids already consumed this pool pass — not reused until every enabled proxy is used once. */
  cycleUsed: string[];
} {
  try {
    if (!fs.existsSync(EGRESS_PROXY_MIRROR_PATH)) {
      return { url: null, proxies: [], assignments: {}, cycleUsed: [] };
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
    const enabledIds = new Set(proxies.filter((p) => p.enabled && p.url).map((p) => p.id));
    const cycleUsed: string[] = [];
    if (Array.isArray(raw?.cycleUsed)) {
      for (const id of raw.cycleUsed) {
        if (typeof id === 'string' && enabledIds.has(id) && !cycleUsed.includes(id)) {
          cycleUsed.push(id);
        }
      }
    }
    // Seed cycle from live assignments if file had none (upgrade path)
    if (!cycleUsed.length) {
      for (const pid of Object.values(assignments)) {
        if (enabledIds.has(pid) && !cycleUsed.includes(pid)) cycleUsed.push(pid);
      }
    }
    return {
      url: activeEgressProxyUrl(proxies),
      proxies,
      assignments,
      cycleUsed,
    };
  } catch {
    return { url: null, proxies: [], assignments: {}, cycleUsed: [] };
  }
}

/**
 * Next proxy in pool order that is not held by another account and not yet
 * used this cycle. When every enabled proxy has been used once, cycle resets
 * (still-held proxies stay reserved) and counting starts again.
 */
function pickNextPoolProxy(
  enabled: EgressProxyEntry[],
  assignments: Record<string, string>,
  cycleUsedIn: string[],
  accountId: string,
  opts?: { forceNew?: boolean; startAfterId?: string | null }
): { pick: EgressProxyEntry | null; cycleUsed: string[]; recycled: boolean } {
  if (!enabled.length) return { pick: null, cycleUsed: [], recycled: false };

  const heldByOthers = new Set(
    Object.entries(assignments)
      .filter(([acc]) => acc !== accountId)
      .map(([, pid]) => pid)
  );

  let cycle = new Set(
    cycleUsedIn.filter((id) => enabled.some((p) => p.id === id))
  );
  let recycled = false;

  const resetCycle = () => {
    cycle = new Set(heldByOthers);
    // Keep this account's current proxy marked if we're rotating away from it
    if (opts?.forceNew && opts.startAfterId) cycle.add(opts.startAfterId);
    recycled = true;
  };

  const tryPick = (): EgressProxyEntry | null => {
    const startIdx = opts?.startAfterId
      ? Math.max(0, enabled.findIndex((p) => p.id === opts.startAfterId))
      : -1;
    for (let i = 1; i <= enabled.length; i++) {
      const cand = enabled[(startIdx + i + enabled.length) % enabled.length];
      if (opts?.forceNew && cand.id === opts.startAfterId) continue;
      if (heldByOthers.has(cand.id)) continue;
      if (cycle.has(cand.id)) continue;
      return cand;
    }
    return null;
  };

  // Pool exhausted this cycle → start again
  if (enabled.every((p) => cycle.has(p.id))) {
    resetCycle();
  }

  let pick = tryPick();
  if (!pick) {
    // No fresh slot left (e.g. all remaining held) → reset and retry
    resetCycle();
    pick = tryPick();
  }
  if (!pick) {
    // More live accounts than proxies — allow simultaneous reuse of least-held
    const counts = new Map(enabled.map((p) => [p.id, 0]));
    for (const pid of heldByOthers) {
      if (counts.has(pid)) counts.set(pid, (counts.get(pid) || 0) + 1);
    }
    pick =
      [...enabled]
        .filter((p) => !opts?.forceNew || p.id !== opts.startAfterId)
        .sort((a, b) => (counts.get(a.id) || 0) - (counts.get(b.id) || 0))[0] || null;
  }

  if (pick) cycle.add(pick.id);
  return { pick, cycleUsed: [...cycle], recycled };
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
 * Assign a sticky proxy: keep existing; otherwise take next unused-in-cycle.
 * Vacated proxies stay off-limits until the full pool has been consumed once.
 */
export function ensureUniqueProxyForAccount(accountId: string): {
  url: string | null;
  proxyId: string | null;
  reused: boolean;
} {
  if (!accountId) return { url: null, proxyId: null, reused: false };
  const { proxies, assignments, cycleUsed } = readEgressProxyMirror();
  const enabled = proxies.filter((p) => p.enabled && p.url);
  if (!enabled.length) return { url: null, proxyId: null, reused: false };

  const existing = assignments[accountId];
  if (existing) {
    const hit = enabled.find((p) => p.id === existing);
    if (hit) return { url: hit.url, proxyId: hit.id, reused: false };
  }

  const { pick, cycleUsed: nextCycle, recycled } = pickNextPoolProxy(
    enabled,
    assignments,
    cycleUsed,
    accountId
  );
  if (!pick) return { url: null, proxyId: null, reused: false };

  writeEgressProxyMirror(
    proxies,
    { ...assignments, [accountId]: pick.id },
    nextCycle
  );
  return { url: pick.url, proxyId: pick.id, reused: recycled };
}

/**
 * Move this account to the next pool proxy not used this cycle (and not held by others).
 * Example: A=1 B=2, B→3, then A→4 (not 2) until the whole pool is used once.
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
  const { proxies, assignments, cycleUsed } = readEgressProxyMirror();
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
  const from = enabled.find((p) => p.id === curId)?.url || null;

  const { pick, cycleUsed: nextCycle } = pickNextPoolProxy(
    enabled,
    assignments,
    cycleUsed,
    accountId,
    { forceNew: true, startAfterId: curId }
  );
  if (!pick) {
    return { ok: false, from, to: from, proxyId: curId, error: 'No proxy available' };
  }

  writeEgressProxyMirror(
    proxies,
    { ...assignments, [accountId]: pick.id },
    nextCycle
  );
  return { ok: true, from, to: pick.url, proxyId: pick.id };
}

/**
 * Reassign every live account to the next unused-in-cycle proxies (pool order).
 * Does not reuse earlier-cycle proxies until the pool has been fully consumed.
 */
export function reassignUniqueProxies(accountIds: string[]): Record<string, string> {
  const { proxies, cycleUsed } = readEgressProxyMirror();
  const enabled = proxies.filter((p) => p.enabled && p.url);
  const assignments: Record<string, string> = {};
  if (!enabled.length || !accountIds.length) {
    writeEgressProxyMirror(proxies, assignments, cycleUsed);
    return assignments;
  }
  const ids = [...new Set(accountIds.filter(Boolean))];
  let cycle = [...cycleUsed];
  for (const acc of ids) {
    const { pick, cycleUsed: next } = pickNextPoolProxy(
      enabled,
      assignments,
      cycle,
      acc
    );
    cycle = next;
    if (pick) assignments[acc] = pick.id;
  }
  writeEgressProxyMirror(proxies, assignments, cycle);
  return assignments;
}

/**
 * Keep sticky assignments where still unique+valid; fill gaps from pool cycle.
 * @returns accountIds whose assignment changed
 */
export function ensureStickyUniqueAssignments(accountIds: string[]): {
  assignments: Record<string, string>;
  changed: string[];
} {
  const { proxies, assignments: prev, cycleUsed } = readEgressProxyMirror();
  const enabled = proxies.filter((p) => p.enabled && p.url);
  const ids = [...new Set(accountIds.filter(Boolean))];
  if (!enabled.length || !ids.length) {
    return { assignments: prev, changed: [] };
  }

  const assignments: Record<string, string> = { ...prev };
  const changed: string[] = [];
  const claimed = new Set<string>();
  let cycle = [...cycleUsed];

  for (const acc of ids) {
    const pid = assignments[acc];
    const hit = pid ? enabled.find((p) => p.id === pid) : null;
    if (hit && !claimed.has(hit.id)) {
      claimed.add(hit.id);
    } else if (pid) {
      delete assignments[acc];
    }
  }

  for (const acc of ids) {
    if (assignments[acc] && enabled.some((p) => p.id === assignments[acc])) {
      const pid = assignments[acc];
      if (!claimed.has(pid)) claimed.add(pid);
      continue;
    }
    const { pick, cycleUsed: next } = pickNextPoolProxy(
      enabled,
      assignments,
      cycle,
      acc
    );
    cycle = next;
    if (!pick) continue;
    assignments[acc] = pick.id;
    claimed.add(pick.id);
    changed.push(acc);
  }

  writeEgressProxyMirror(proxies, assignments, cycle);
  return { assignments, changed };
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


