import fs from 'fs';
import path from 'path';

/** Lightweight mirror for middleware / timers (no Prisma needed). */
export const SITE_RUNTIME_PATH = path.join(process.cwd(), 'data', 'site-runtime.json');
/** Edge-middleware-readable flag (static, no Node self-fetch). */
export const MAINTENANCE_PUBLIC_PATH = path.join(
  process.cwd(),
  'public',
  'maintenance-status.json'
);

export type SiteRuntime = {
  maintenanceMode: boolean;
  proxyAutoRotateEnabled: boolean;
  proxyAutoRotateMinutes: number;
  lastProxyRotateAt: string | null;
  lastProxyRotateReason: string | null;
  updatedAt: string | null;
};

const DEFAULTS: SiteRuntime = {
  maintenanceMode: false,
  proxyAutoRotateEnabled: false,
  proxyAutoRotateMinutes: 60,
  lastProxyRotateAt: null,
  lastProxyRotateReason: null,
  updatedAt: null,
};

function writePublicMaintenanceFlag(maintenanceMode: boolean) {
  try {
    fs.mkdirSync(path.dirname(MAINTENANCE_PUBLIC_PATH), { recursive: true });
    fs.writeFileSync(
      MAINTENANCE_PUBLIC_PATH,
      JSON.stringify(
        { maintenanceMode: !!maintenanceMode, updatedAt: new Date().toISOString() },
        null,
        2
      ),
      'utf8'
    );
  } catch (e) {
    console.warn('[site-runtime] public maintenance flag write failed:', e);
  }
}

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
      lastProxyRotateReason:
        typeof raw.lastProxyRotateReason === 'string' ? raw.lastProxyRotateReason : null,
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
  writePublicMaintenanceFlag(next.maintenanceMode);
  return next;
}

/** Prefer DB, fall back to runtime file. */
export async function resolveMaintenanceMode(): Promise<boolean> {
  try {
    const { prisma } = await import('./prisma');
    const row = await prisma.siteSettings.findUnique({ where: { id: 'default' } });
    if (row && typeof (row as any).maintenanceMode === 'boolean') {
      return !!(row as any).maintenanceMode;
    }
  } catch {
    /* ignore */
  }
  return readSiteRuntime().maintenanceMode;
}
