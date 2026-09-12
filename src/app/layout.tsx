import type { Metadata, Viewport } from 'next';
import { Poppins, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import { SiteSettingsProvider } from '@/components/SiteSettingsProvider';

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

export const metadata: Metadata = {
  title: 'Flowbysk — Cinema, on demand',
  description:
    'Direct API access to generative video and image models in a Flow-like studio — no extension, no logouts.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#090b10',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-[var(--bg)] font-body text-[var(--ink)] antialiased">
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('flowbysk-theme');if(t==='light'||t==='dark'){document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.classList.toggle('light',t==='light');document.documentElement.dataset.theme=t;}}catch(e){}})();`,
          }}
        />
        <ThemeProvider>
          <SiteSettingsProvider>{children}</SiteSettingsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
