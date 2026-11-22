'use client';

import Link from 'next/link';
import { useSiteSettings } from './SiteSettingsProvider';
import SiteBrand from './SiteBrand';

export default function Footer() {
  const { siteName, contactPageEnabled } = useSiteSettings();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-[var(--line)] bg-[var(--bg2)]">
      <div className="flow-container grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3">
          <SiteBrand compact />
          <p className="max-w-[220px] text-sm leading-relaxed text-[var(--ink3)]">
            Where the next wave of storytelling happens.
          </p>
        </div>
        <div className="flex flex-col gap-2.5">
          <span className="font-mono mb-1 text-[10px] tracking-[0.1em] text-[var(--ink3)]">PRODUCT</span>
          <Link href="/features" className="text-sm text-[var(--ink2)] hover:text-[var(--ink)]">
            Features
          </Link>
          <Link href="/pricing" className="text-sm text-[var(--ink2)] hover:text-[var(--ink)]">
            Pricing
          </Link>
          <Link href="/dashboard" className="text-sm text-[var(--ink2)] hover:text-[var(--ink)]">
            Dashboard
          </Link>
        </div>
        <div className="flex flex-col gap-2.5">
          <span className="font-mono mb-1 text-[10px] tracking-[0.1em] text-[var(--ink3)]">COMPANY</span>
          <Link href="/about" className="text-sm text-[var(--ink2)] hover:text-[var(--ink)]">
            About
          </Link>
          {contactPageEnabled !== false && (
            <Link href="/contact" className="text-sm text-[var(--ink2)] hover:text-[var(--ink)]">
              Contact
            </Link>
          )}
          <Link href="/guide" className="text-sm text-[var(--ink2)] hover:text-[var(--ink)]">
            Credit guide
          </Link>
        </div>
        <div className="flex flex-col gap-2.5">
          <span className="font-mono mb-1 text-[10px] tracking-[0.1em] text-[var(--ink3)]">LEGAL</span>
          <span className="text-sm text-[var(--ink2)]">Privacy</span>
          <span className="text-sm text-[var(--ink2)]">Terms</span>
          <span className="text-sm text-[var(--ink2)]">Content policy</span>
        </div>
      </div>
      <div className="flow-container flex flex-wrap items-center justify-between gap-4 border-t border-[var(--line)] py-5 pb-10">
        <span className="text-[13px] text-[var(--ink3)]">
          © {year} {siteName}. All rights reserved.
        </span>
        <span className="font-mono text-[11px] tracking-[0.08em] text-[var(--ink3)]">
          POWERED BY GOOGLE FLOW
        </span>
      </div>
    </footer>
  );
}
