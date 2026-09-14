import type { Metadata, Viewport } from 'next';
import { Poppins, JetBrains_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import { SiteSettingsProvider } from '@/components/SiteSettingsProvider';
import { getSiteSettings } from '@/lib/site-settings';
import { resolveMaintenanceMode } from '@/lib/siteRuntime';
import MaintenancePage from './maintenance/page';

const body = Poppins({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700'],
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
});

export async function generateMetadata(): Promise<Metadata> {
  try {
    const settings = await getSiteSettings();
    const name = settings.siteName?.trim() || 'Flowbysk';
    return {
      title: `${name} — Cinema, on demand`,
      description:
        'Direct API access to generative video and image models in a Flow-like studio — no extension, no logouts.',
    };
  } catch {
    return {
      title: 'Flowbysk — Cinema, on demand',
      description:
        'Direct API access to generative video and image models in a Flow-like studio — no extension, no logouts.',
    };
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#090b10',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const bypass = jar.get('mod_admin')?.value === '1';
  let maintenance = false;
  try {
    maintenance = await resolveMaintenanceMode();
  } catch {
    maintenance = false;
  }

  return (
    <html lang="en" className={`dark ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-[var(--bg)] font-body text-[var(--ink)] antialiased">
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('flowbysk-theme');if(t==='light'||t==='dark'){document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.classList.toggle('light',t==='light');document.documentElement.dataset.theme=t;}}catch(e){}})();`,
          }}
        />
        <ThemeProvider>
          <SiteSettingsProvider>
            {maintenance && !bypass ? <MaintenancePage /> : children}
          </SiteSettingsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
