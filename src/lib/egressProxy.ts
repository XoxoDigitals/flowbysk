import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

/** Mirror file read by Python worker + BiB without DB access. */
export const EGRESS_PROXY_MIRROR_PATH = path.join(process.cwd(), 'data', 'egress-proxy.json');

export type EgressProxyEntry = {
  id: string;
  url: string;
  enabled: boolean;
};

/**
 * Accept http(s)://..., host:port, user:pass@host:port.
 * Returns canonical URL or null.
 */
export function normalizeEgressProxyUrl(raw?: string | null): string | null {
  let text = String(raw ?? '').trim();
  if (!text) return null;

  // Common paste forms without scheme
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text)) {
    text = `http://${text}`;
  }

  try {
    const u = new URL(text);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    // Rebuild so we always persist a parseable absolute URL
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
