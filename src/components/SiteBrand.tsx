'use client';

import Link from 'next/link';
import { useSiteSettings } from './SiteSettingsProvider';

export default function SiteBrand({
  href = '/',
  compact = false,
  className = '',
}: {
  href?: string;
  compact?: boolean;
  className?: string;
}) {
  const { siteName, logoUrl } = useSiteSettings();
  const name = siteName || 'Flowbysk';

  return (
    <Link href={href} className={`flex items-center gap-2.5 text-[var(--ink)] ${className}`}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={name}
          className={`rounded-lg object-contain ${compact ? 'h-[22px] w-[22px]' : 'h-[26px] w-[26px]'}`}
        />
      ) : (
        <span
          className={`block rounded-lg bg-gradient-to-br from-[var(--a1)] to-[var(--a2)] ${
            compact ? 'h-[22px] w-[22px] rounded-[7px]' : 'h-[26px] w-[26px] rounded-[8px]'
          }`}
        />
      )}
      <span className={`font-semibold tracking-[-0.02em] ${compact ? 'text-[17px]' : 'text-[19px]'}`}>
        {name}
      </span>
    </Link>
  );
}
