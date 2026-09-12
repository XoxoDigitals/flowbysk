'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PublicSiteSettings } from '@/lib/site-settings';

const defaults: PublicSiteSettings = {
  siteName: 'Flowbysk',
  logoUrl: null,
  contactEmail: 'support@flowbysk.com',
};

const SiteSettingsContext = createContext<PublicSiteSettings>(defaults);

export function SiteSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PublicSiteSettings>(defaults);

  useEffect(() => {
    fetch('/api/site-settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.settings) setSettings(data.settings);
      })
      .catch(() => {});
  }, []);

  return (
    <SiteSettingsContext.Provider value={settings}>{children}</SiteSettingsContext.Provider>
  );
}

export function useSiteSettings() {
  return useContext(SiteSettingsContext);
}
