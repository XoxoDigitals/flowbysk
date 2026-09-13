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

export type PublicSiteSettings = {
  siteName: string;
  logoUrl: string | null;
  contactEmail: string;
  allowSignups: boolean;
  ticketSystemEnabled: boolean;
  contactPageEnabled: boolean;
};

/** Admin-only fields (not exposed on public site-settings API). */
export type AdminSiteSettings = PublicSiteSettings & {
  egressProxyUrl: string | null;
  egressProxies: EgressProxyEntry[];
};

const DEFAULTS: PublicSiteSettings = {
  siteName: 'Flowbysk',
  logoUrl: null,
  contactEmail: 'support@flowbysk.com',
  allowSignups: true,
  ticketSystemEnabled: true,
  contactPageEnabled: true,
};

function mapPublic(row: {
  siteName: string;
  logoUrl: string | null;
  contactEmail: string;
  allowSignups: boolean;
  ticketSystemEnabled: boolean;
  contactPageEnabled?: boolean;
}): PublicSiteSettings {
  return {
    siteName: row.siteName || DEFAULTS.siteName,
    logoUrl: row.logoUrl,
    contactEmail: row.contactEmail || DEFAULTS.contactEmail,
    allowSignups: row.allowSignups !== false,
    ticketSystemEnabled: row.ticketSystemEnabled !== false,
    contactPageEnabled: row.contactPageEnabled !== false,
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
  egressProxyUrl?: string | null;
  egressProxies?: unknown;
}): AdminSiteSettings {
  const egressProxies = proxiesFromRow(row);
  return {
    ...mapPublic(row),
    egressProxies,
    egressProxyUrl: activeEgressProxyUrl(egressProxies),
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
      },
      update: {},
    });
    return mapPublic(row);
  } catch {
    return { ...DEFAULTS };
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
      },
      update: {},
    });
    return mapAdmin(row);
  } catch {
    const mirror = readEgressProxyMirror();
    return {
      ...DEFAULTS,
      egressProxyUrl: mirror.url,
      egressProxies: mirror.proxies,
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
  egressProxyUrl?: string | null;
  egressProxies?: EgressProxyEntry[] | unknown;
}): Promise<AdminSiteSettings> {
  let proxies: EgressProxyEntry[] | undefined;

  if (data.egressProxies !== undefined) {
    proxies = normalizeEgressProxyList(data.egressProxies);
    if (Array.isArray(data.egressProxies) && data.egressProxies.length > 0 && proxies.length === 0) {
      throw new Error(
        'Invalid proxy URL(s). Use http://host:port or http://user:pass@host:port (or host:port).'
      );
    }
  } else if (data.egressProxyUrl !== undefined) {
    const url = normalizeEgressProxyUrl(data.egressProxyUrl);
    if (data.egressProxyUrl && String(data.egressProxyUrl).trim() && !url) {
      throw new Error(
        'Invalid proxy URL. Use http://host:port or http://user:pass@host:port (or host:port).'
      );
    }
    proxies = url ? [{ id: randomUUID(), url, enabled: true }] : [];
  }

  const active = proxies ? activeEgressProxyUrl(proxies) : undefined;

  if (proxies !== undefined) {
    writeEgressProxyMirror(proxies);
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
        ...(proxies !== undefined
          ? { egressProxies: proxies, egressProxyUrl: active }
          : {}),
      },
    });
    return mapAdmin(row);
  } catch (e) {
    console.warn('[site-settings] DB update partial failure:', e);
    const publicPart = await getSiteSettings().catch(() => ({ ...DEFAULTS }));
    const mirror = readEgressProxyMirror();
    return {
      ...publicPart,
      egressProxies: proxies ?? mirror.proxies,
      egressProxyUrl: active ?? mirror.url,
    };
  }
}
