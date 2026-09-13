import fs from 'fs';
import path from 'path';

/** Mirror file read by Python worker + BiB without DB access. */
export const EGRESS_PROXY_MIRROR_PATH = path.join(process.cwd(), 'data', 'egress-proxy.json');

export function normalizeEgressProxyUrl(raw?: string | null): string | null {
  const text = String(raw ?? '').trim();
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

export function writeEgressProxyMirror(url: string | null): void {
  const dir = path.dirname(EGRESS_PROXY_MIRROR_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    EGRESS_PROXY_MIRROR_PATH,
    JSON.stringify({ url: url || '', updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

export function readEgressProxyMirror(): string | null {
  try {
    if (!fs.existsSync(EGRESS_PROXY_MIRROR_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(EGRESS_PROXY_MIRROR_PATH, 'utf8'));
    return normalizeEgressProxyUrl(raw?.url);
  } catch {
    return null;
  }
}
