import { prisma } from './prisma';

export type PublicSiteSettings = {
  siteName: string;
  logoUrl: string | null;
  contactEmail: string;
  allowSignups: boolean;
};

const DEFAULTS: PublicSiteSettings = {
  siteName: 'Flowbysk',
  logoUrl: null,
  contactEmail: 'support@flowbysk.com',
  allowSignups: true,
};

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
      },
      update: {},
    });
    return {
      siteName: row.siteName || DEFAULTS.siteName,
      logoUrl: row.logoUrl,
      contactEmail: row.contactEmail || DEFAULTS.contactEmail,
      allowSignups: row.allowSignups !== false,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function updateSiteSettings(data: {
  siteName?: string;
  logoUrl?: string | null;
  contactEmail?: string;
  allowSignups?: boolean;
}): Promise<PublicSiteSettings> {
  const row = await prisma.siteSettings.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      siteName: data.siteName?.trim() || DEFAULTS.siteName,
      logoUrl: data.logoUrl ?? null,
      contactEmail: data.contactEmail?.trim() || DEFAULTS.contactEmail,
      allowSignups: data.allowSignups ?? DEFAULTS.allowSignups,
    },
    update: {
      ...(data.siteName !== undefined ? { siteName: data.siteName.trim() || DEFAULTS.siteName } : {}),
      ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl } : {}),
      ...(data.contactEmail !== undefined
        ? { contactEmail: data.contactEmail.trim() || DEFAULTS.contactEmail }
        : {}),
      ...(data.allowSignups !== undefined ? { allowSignups: Boolean(data.allowSignups) } : {}),
    },
  });
  return {
    siteName: row.siteName,
    logoUrl: row.logoUrl,
    contactEmail: row.contactEmail,
    allowSignups: row.allowSignups !== false,
  };
}
