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
 * Accept http(s)://..., host:port, user:pass@host:port.
 * Returns canonical URL or null.
 */
export function normalizeEgressProxyUrl(raw?: string | null): string | null {
  let text = String(raw ?? '').trim();
  if (!text) return null;

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

export function writeEgressProxyMirror(proxies: EgressProxyEntry[]): void {
  const dir = path.dirname(EGRESS_PROXY_MIRROR_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const url = activeEgressProxyUrl(proxies) || '';
  fs.writeFileSync(
    EGRESS_PROXY_MIRROR_PATH,
    JSON.stringify(
      {
        url,
        proxies,
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
} {
  try {
    if (!fs.existsSync(EGRESS_PROXY_MIRROR_PATH)) {
      return { url: null, proxies: [] };
    }
    const raw = JSON.parse(fs.readFileSync(EGRESS_PROXY_MIRROR_PATH, 'utf8'));
    const proxies = normalizeEgressProxyList(raw?.proxies);
    if (!proxies.length && raw?.url) {
      const url = normalizeEgressProxyUrl(raw.url);
      if (url) proxies.push({ id: 'legacy', url, enabled: true });
    }
    return { url: activeEgressProxyUrl(proxies), proxies };
  } catch {
    return { url: null, proxies: [] };
  }
}

/**
 * Fetch public IP + country via the given HTTP proxy (proves proxy works).
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

  try {
    const { ProxyAgent, fetch: undiciFetch } = await import('undici');
    const dispatcher = new ProxyAgent(normalized);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await undiciFetch('https://ipapi.co/json/', {
        dispatcher,
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'Flowbysk-ProxyCheck/1.0' },
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || !data) {
        // Fallback: ipify IP only
        const ipRes = await undiciFetch('https://api.ipify.org?format=json', {
          dispatcher,
          signal: controller.signal,
        });
        const ipData = (await ipRes.json().catch(() => null)) as { ip?: string } | null;
        if (ipData?.ip) {
          return { ok: true, ip: ipData.ip, country: 'Unknown', countryCode: '' };
        }
        return { ok: false, error: `Lookup failed (${res.status})` };
      }
      if (data.error) {
        return { ok: false, error: String(data.reason || data.error || 'lookup failed') };
      }
      const ip = String(data.ip || '');
      if (!ip) return { ok: false, error: 'No IP in response' };
      return {
        ok: true,
        ip,
        country: String(data.country_name || data.country || 'Unknown'),
        countryCode: String(data.country_code || data.country || ''),
      };
    } finally {
      clearTimeout(timer);
      try {
        await dispatcher.close();
      } catch {
        /* ignore */
      }
    }
  } catch (e: any) {
    const msg = e?.cause?.message || e?.message || String(e);
    return { ok: false, error: msg.slice(0, 200) };
  }
}
