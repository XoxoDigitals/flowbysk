import { prisma } from './prisma';
import {
  activeEgressProxyUrl,
  EgressProxyEntry,
  normalizeEgressProxyList,
  normalizeEgressProxyUrl,
  readEgressProxyMirror,
  writeEgressProxyMirror,
} from './egressProxy';
import { randomUUID } from 'crypto';
import { readSiteRuntime, writeSiteRuntimePatch } from './siteRuntime';

export type PublicSiteSettings = {
  siteName: string;
  logoUrl: string | null;
  contactEmail: string;
  allowSignups: boolean;
  ticketSystemEnabled: boolean;
  contactPageEnabled: boolean;
  maintenanceMode: boolean;
};

/** Admin-only fields (not exposed on public site-settings API). */
export type AdminSiteSettings = PublicSiteSettings & {
  egressProxyUrl: string | null;
  egressProxies: EgressProxyEntry[];
  proxyAutoRotateEnabled: boolean;
  proxyAutoRotateMinutes: number;
  lastProxyRotateAt: string | null;
  lastProxyRotateReason: string | null;
};

const DEFAULTS: PublicSiteSettings = {
  siteName: 'Flowbysk',
  logoUrl: null,
  contactEmail: 'support@flowbysk.com',
  allowSignups: true,
  ticketSystemEnabled: true,
  contactPageEnabled: true,
  maintenanceMode: false,
};

function mapPublic(row: {
  siteName: string;
  logoUrl: string | null;
  contactEmail: string;
  allowSignups: boolean;
  ticketSystemEnabled: boolean;
  contactPageEnabled?: boolean;
  maintenanceMode?: boolean;
}): PublicSiteSettings {
  const rt = readSiteRuntime();
  return {
    siteName: row.siteName || DEFAULTS.siteName,
    logoUrl: row.logoUrl,
    contactEmail: row.contactEmail || DEFAULTS.contactEmail,
    allowSignups: row.allowSignups !== false,
    ticketSystemEnabled: row.ticketSystemEnabled !== false,
    contactPageEnabled: row.contactPageEnabled !== false,
    maintenanceMode:
      typeof row.maintenanceMode === 'boolean' ? row.maintenanceMode : rt.maintenanceMode,
  };
}

function proxiesFromRow(row: {
  egressProxyUrl?: string | null;
  egressProxies?: unknown;
}): EgressProxyEntry[] {
  const mirror = readEgressProxyMirror();
  if (mirror.proxies.length) return mirror.proxies;

  let proxies = normalizeEgressProxyList(row.egressProxies);
  if (!proxies.length) {
    const legacy = normalizeEgressProxyUrl(row.egressProxyUrl ?? null);
    if (legacy) {
      proxies = [{ id: randomUUID(), url: legacy, enabled: true }];
    }
  }
  return proxies;
}

function mapAdmin(row: {
  siteName: string;
  logoUrl: string | null;
  contactEmail: string;
  allowSignups: boolean;
  ticketSystemEnabled: boolean;
  contactPageEnabled?: boolean;
  maintenanceMode?: boolean;
  proxyAutoRotateEnabled?: boolean;
  proxyAutoRotateMinutes?: number;
  egressProxyUrl?: string | null;
  egressProxies?: unknown;
}): AdminSiteSettings {
  const egressProxies = proxiesFromRow(row);
  const rt = readSiteRuntime();
  return {
    ...mapPublic(row),
    egressProxies,
    egressProxyUrl: activeEgressProxyUrl(egressProxies),
    proxyAutoRotateEnabled:
      typeof row.proxyAutoRotateEnabled === 'boolean'
        ? row.proxyAutoRotateEnabled
        : rt.proxyAutoRotateEnabled,
    proxyAutoRotateMinutes:
      typeof row.proxyAutoRotateMinutes === 'number'
        ? row.proxyAutoRotateMinutes
        : rt.proxyAutoRotateMinutes,
    lastProxyRotateAt: rt.lastProxyRotateAt,
    lastProxyRotateReason: rt.lastProxyRotateReason,
  };
}

export async function getSiteSettings(): Promise<PublicSiteSettings> {
  try {
    const row = await prisma.siteSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        siteName: DEFAULTS.siteName,
        logoUrl: DEFAULTS.logoUrl,
        contactEmail: DEFAULTS.contactEmail,
        allowSignups: DEFAULTS.allowSignups,
        ticketSystemEnabled: DEFAULTS.ticketSystemEnabled,
        contactPageEnabled: DEFAULTS.contactPageEnabled,
        maintenanceMode: DEFAULTS.maintenanceMode,
      },
      update: {},
    });
    return mapPublic(row as any);
  } catch {
    return { ...DEFAULTS, maintenanceMode: readSiteRuntime().maintenanceMode };
  }
}

export async function getAdminSiteSettings(): Promise<AdminSiteSettings> {
  try {
    const row = await prisma.siteSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        siteName: DEFAULTS.siteName,
        logoUrl: DEFAULTS.logoUrl,
        contactEmail: DEFAULTS.contactEmail,
        allowSignups: DEFAULTS.allowSignups,
        ticketSystemEnabled: DEFAULTS.ticketSystemEnabled,
        contactPageEnabled: DEFAULTS.contactPageEnabled,
        maintenanceMode: DEFAULTS.maintenanceMode,
      },
      update: {},
    });
    const mapped = mapAdmin(row as any);
    // Keep middleware/timer mirror in sync with DB
    writeSiteRuntimePatch({
      maintenanceMode: mapped.maintenanceMode,
      proxyAutoRotateEnabled: mapped.proxyAutoRotateEnabled,
      proxyAutoRotateMinutes: mapped.proxyAutoRotateMinutes,
    });
    return mapped;
  } catch {
    const mirror = readEgressProxyMirror();
    const rt = readSiteRuntime();
    return {
      ...DEFAULTS,
      maintenanceMode: rt.maintenanceMode,
      egressProxyUrl: mirror.url,
      egressProxies: mirror.proxies,
      proxyAutoRotateEnabled: rt.proxyAutoRotateEnabled,
      proxyAutoRotateMinutes: rt.proxyAutoRotateMinutes,
      lastProxyRotateAt: rt.lastProxyRotateAt,
      lastProxyRotateReason: rt.lastProxyRotateReason,
    };
  }
}

export async function updateSiteSettings(data: {
  siteName?: string;
  logoUrl?: string | null;
  contactEmail?: string;
  allowSignups?: boolean;
  ticketSystemEnabled?: boolean;
  contactPageEnabled?: boolean;
  maintenanceMode?: boolean;
  proxyAutoRotateEnabled?: boolean;
  proxyAutoRotateMinutes?: number;
  egressProxyUrl?: string | null;
  egressProxies?: EgressProxyEntry[] | unknown;
}): Promise<AdminSiteSettings> {
  let proxies: EgressProxyEntry[] | undefined;

  if (data.egressProxies !== undefined) {
    proxies = normalizeEgressProxyList(data.egressProxies);
    if (Array.isArray(data.egressProxies) && data.egressProxies.length > 0 && proxies.length === 0) {
      throw new Error(
        'Invalid proxy URL(s). Use host:port:user:pass or http://user:pass@host:port.'
      );
    }
  } else if (data.egressProxyUrl !== undefined) {
    const url = normalizeEgressProxyUrl(data.egressProxyUrl);
    if (data.egressProxyUrl && String(data.egressProxyUrl).trim() && !url) {
      throw new Error(
        'Invalid proxy URL. Use host:port:user:pass or http://user:pass@host:port.'
      );
    }
    proxies = url ? [{ id: randomUUID(), url, enabled: true }] : [];
  }

  const active = proxies ? activeEgressProxyUrl(proxies) : undefined;

  if (proxies !== undefined) {
    writeEgressProxyMirror(proxies);
  }

  if (
    data.maintenanceMode !== undefined ||
    data.proxyAutoRotateEnabled !== undefined ||
    data.proxyAutoRotateMinutes !== undefined
  ) {
    writeSiteRuntimePatch({
      ...(data.maintenanceMode !== undefined
        ? { maintenanceMode: Boolean(data.maintenanceMode) }
        : {}),
      ...(data.proxyAutoRotateEnabled !== undefined
        ? { proxyAutoRotateEnabled: Boolean(data.proxyAutoRotateEnabled) }
        : {}),
      ...(data.proxyAutoRotateMinutes !== undefined
        ? { proxyAutoRotateMinutes: Number(data.proxyAutoRotateMinutes) || 60 }
        : {}),
    });
  }

  try {
    const row = await prisma.siteSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        siteName: data.siteName?.trim() || DEFAULTS.siteName,
        logoUrl: data.logoUrl ?? null,
        contactEmail: data.contactEmail?.trim() || DEFAULTS.contactEmail,
        allowSignups: data.allowSignups ?? DEFAULTS.allowSignups,
        ticketSystemEnabled: data.ticketSystemEnabled ?? DEFAULTS.ticketSystemEnabled,
        contactPageEnabled: data.contactPageEnabled ?? DEFAULTS.contactPageEnabled,
        maintenanceMode: data.maintenanceMode ?? DEFAULTS.maintenanceMode,
        proxyAutoRotateEnabled: data.proxyAutoRotateEnabled ?? false,
        proxyAutoRotateMinutes: data.proxyAutoRotateMinutes ?? 60,
        egressProxyUrl: active ?? null,
        egressProxies: proxies ?? [],
      },
      update: {
        ...(data.siteName !== undefined ? { siteName: data.siteName.trim() || DEFAULTS.siteName } : {}),
        ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl } : {}),
        ...(data.contactEmail !== undefined
          ? { contactEmail: data.contactEmail.trim() || DEFAULTS.contactEmail }
          : {}),
        ...(data.allowSignups !== undefined ? { allowSignups: Boolean(data.allowSignups) } : {}),
        ...(data.ticketSystemEnabled !== undefined
          ? { ticketSystemEnabled: Boolean(data.ticketSystemEnabled) }
          : {}),
        ...(data.contactPageEnabled !== undefined
          ? { contactPageEnabled: Boolean(data.contactPageEnabled) }
          : {}),
        ...(data.maintenanceMode !== undefined
          ? { maintenanceMode: Boolean(data.maintenanceMode) }
          : {}),
        ...(data.proxyAutoRotateEnabled !== undefined
          ? { proxyAutoRotateEnabled: Boolean(data.proxyAutoRotateEnabled) }
          : {}),
        ...(data.proxyAutoRotateMinutes !== undefined
          ? { proxyAutoRotateMinutes: Math.max(1, Number(data.proxyAutoRotateMinutes) || 60) }
          : {}),
        ...(proxies !== undefined
          ? { egressProxies: proxies, egressProxyUrl: active }
          : {}),
      },
    });
    return mapAdmin(row as any);
  } catch (e) {
    console.warn('[site-settings] DB update partial failure:', e);
    const publicPart = await getSiteSettings().catch(() => ({ ...DEFAULTS }));
    const mirror = readEgressProxyMirror();
    const rt = readSiteRuntime();
    return {
      ...publicPart,
      egressProxies: proxies ?? mirror.proxies,
      egressProxyUrl: active ?? mirror.url,
      proxyAutoRotateEnabled: rt.proxyAutoRotateEnabled,
      proxyAutoRotateMinutes: rt.proxyAutoRotateMinutes,
      lastProxyRotateAt: rt.lastProxyRotateAt,
      lastProxyRotateReason: rt.lastProxyRotateReason,
    };
  }
}
