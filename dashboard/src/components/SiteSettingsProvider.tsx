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
import { FLOW_API } from '@/lib/flowApi';

const defaults: PublicSiteSettings = {
  siteName: 'Flow Creator Ai',
  logoUrl: null,
  contactEmail: 'support@flowcreator.ai',
  allowSignups: true,
  ticketSystemEnabled: true,
  contactPageEnabled: true,
  maintenanceMode: false,
  socialLinks: {},
};

function normalizeName(name: unknown): string {
  const n = String(name || '').trim();
  if (!n || /^(flowbysk|google flow|flow browser)$/i.test(n)) return 'Flow Creator Ai';
  return n;
}

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
      // Prefer Express branding (Flow Browser source of truth).
      const expressRes = await fetch(`${FLOW_API}/api/public/branding`, { cache: 'no-store' });
      if (expressRes.ok) {
        const data = await expressRes.json();
        if (data?.settings) {
          setSettings({
            ...defaults,
            ...data.settings,
            siteName: normalizeName(data.settings.siteName || data.settings.appName),
          });
          return;
        }
      }
    } catch {
      /* fall through */
    }

    try {
      const r = await fetch('/api/site-settings', { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      if (data?.settings) {
        setSettings({
          ...data.settings,
          siteName: normalizeName(data.settings.siteName),
        });
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshSiteSettings();
  }, [refreshSiteSettings]);

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
