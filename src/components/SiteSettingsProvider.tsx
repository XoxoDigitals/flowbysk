'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { PublicSiteSettings } from '@/lib/site-settings';

const defaults: PublicSiteSettings = {
  siteName: 'Flowbysk',
  logoUrl: null,
  contactEmail: 'support@flowbysk.com',
  allowSignups: true,
  ticketSystemEnabled: true,
  contactPageEnabled: true,
  maintenanceMode: false,
  socialLinks: {},
};

type SiteSettingsContextValue = PublicSiteSettings & {
  refreshSiteSettings: () => Promise<void>;
};

const SiteSettingsContext = createContext<SiteSettingsContextValue>({
  ...defaults,
  refreshSiteSettings: async () => {},
});

export function SiteSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PublicSiteSettings>(defaults);

  const refreshSiteSettings = useCallback(async () => {
    try {
      const r = await fetch('/api/site-settings', { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      if (data?.settings) setSettings(data.settings);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshSiteSettings();
  }, [refreshSiteSettings]);

  useEffect(() => {
    const name = String(settings.siteName || 'Flowbysk').trim() || 'Flowbysk';
    if (typeof document !== 'undefined') {
      document.title = `${name} — Cinema, on demand`;
    }
  }, [settings.siteName]);

  const value = useMemo(
    () => ({ ...settings, refreshSiteSettings }),
    [settings, refreshSiteSettings]
  );

  return (
    <SiteSettingsContext.Provider value={value}>{children}</SiteSettingsContext.Provider>
  );
}

export function useSiteSettings() {
  return useContext(SiteSettingsContext);
}
