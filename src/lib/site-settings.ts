import { prisma } from './prisma';

export type PublicSiteSettings = {
  siteName: string;
  logoUrl: string | null;
  contactEmail: string;
};

const DEFAULTS: PublicSiteSettings = {
  siteName: 'Flowbysk',
  logoUrl: null,
  contactEmail: 'support@flowbysk.com',
};

export async function getSiteSettings(): Promise<PublicSiteSettings> {
  try {
    const row = await prisma.siteSettings.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...DEFAULTS },
      update: {},
    });
    return {
      siteName: row.siteName || DEFAULTS.siteName,
      logoUrl: row.logoUrl,
      contactEmail: row.contactEmail || DEFAULTS.contactEmail,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function updateSiteSettings(data: {
  siteName?: string;
  logoUrl?: string | null;
  contactEmail?: string;
}): Promise<PublicSiteSettings> {
  const row = await prisma.siteSettings.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      siteName: data.siteName?.trim() || DEFAULTS.siteName,
      logoUrl: data.logoUrl ?? null,
      contactEmail: data.contactEmail?.trim() || DEFAULTS.contactEmail,
    },
    update: {
      ...(data.siteName !== undefined ? { siteName: data.siteName.trim() || DEFAULTS.siteName } : {}),
      ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl } : {}),
      ...(data.contactEmail !== undefined
        ? { contactEmail: data.contactEmail.trim() || DEFAULTS.contactEmail }
        : {}),
    },
  });
  return {
    siteName: row.siteName,
    logoUrl: row.logoUrl,
    contactEmail: row.contactEmail,
  };
}
