import fs from 'fs';
import path from 'path';

/** Lightweight mirror for middleware / timers (no Prisma needed). */
export const SITE_RUNTIME_PATH = path.join(process.cwd(), 'data', 'site-runtime.json');

export type SiteRuntime = {
  maintenanceMode: boolean;
  proxyAutoRotateEnabled: boolean;
  proxyAutoRotateMinutes: number;
  lastProxyRotateAt: string | null;
  updatedAt: string | null;
};

const DEFAULTS: SiteRuntime = {
  maintenanceMode: false,
  proxyAutoRotateEnabled: false,
  proxyAutoRotateMinutes: 60,
  lastProxyRotateAt: null,
  updatedAt: null,
};

export function readSiteRuntime(): SiteRuntime {
  try {
    if (!fs.existsSync(SITE_RUNTIME_PATH)) return { ...DEFAULTS };
    const raw = JSON.parse(fs.readFileSync(SITE_RUNTIME_PATH, 'utf8'));
    return {
      maintenanceMode: !!raw.maintenanceMode,
      proxyAutoRotateEnabled: !!raw.proxyAutoRotateEnabled,
      proxyAutoRotateMinutes: Math.max(
        1,
        Math.min(24 * 60, Number(raw.proxyAutoRotateMinutes) || 60)
      ),
      lastProxyRotateAt:
        typeof raw.lastProxyRotateAt === 'string' ? raw.lastProxyRotateAt : null,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSiteRuntimePatch(patch: Partial<SiteRuntime>): SiteRuntime {
  const prev = readSiteRuntime();
  const next: SiteRuntime = {
    ...prev,
    ...patch,
    proxyAutoRotateMinutes: Math.max(
      1,
      Math.min(
        24 * 60,
        Number(
          patch.proxyAutoRotateMinutes !== undefined
            ? patch.proxyAutoRotateMinutes
            : prev.proxyAutoRotateMinutes
        ) || 60
      )
    ),
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(SITE_RUNTIME_PATH), { recursive: true });
  fs.writeFileSync(SITE_RUNTIME_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
