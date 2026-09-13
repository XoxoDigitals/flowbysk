import { prisma } from './prisma';
import { normalizeEgressProxyUrl, writeEgressProxyMirror } from './egressProxy';

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

function mapAdmin(row: {
  siteName: string;
  logoUrl: string | null;
  contactEmail: string;
  allowSignups: boolean;
  ticketSystemEnabled: boolean;
  contactPageEnabled?: boolean;
  egressProxyUrl?: string | null;
}): AdminSiteSettings {
  return {
    ...mapPublic(row),
    egressProxyUrl: normalizeEgressProxyUrl(row.egressProxyUrl ?? null),
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
    return { ...DEFAULTS, egressProxyUrl: null };
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
}): Promise<AdminSiteSettings> {
  const proxy =
    data.egressProxyUrl !== undefined
      ? normalizeEgressProxyUrl(data.egressProxyUrl)
      : undefined;

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
      egressProxyUrl: proxy ?? null,
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
      ...(proxy !== undefined ? { egressProxyUrl: proxy } : {}),
    },
  });

  const admin = mapAdmin(row);
  try {
    writeEgressProxyMirror(admin.egressProxyUrl);
  } catch (e) {
    console.warn('[site-settings] egress proxy mirror write failed:', e);
  }
  return admin;
}
