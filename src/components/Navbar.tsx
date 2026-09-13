'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import SiteBrand from './SiteBrand';
import ThemeToggle from './ThemeToggle';
import { useSiteSettings } from './SiteSettingsProvider';

export default function Navbar() {
  const pathname = usePathname();
  const { contactPageEnabled } = useSiteSettings();
  const [user, setUser] = useState<{ email: string; role: string } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.authenticated && data.user) setUser(data.user);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const link = (href: string, label: string, onClick?: () => void) => {
    const active =
      href === '/'
        ? pathname === '/'
        : pathname === href || pathname?.startsWith(href + '/');
    return (
      <Link
        href={href}
        onClick={onClick}
        className={`nav-link ${active ? 'nav-link-active' : ''}`}
      >
        {label}
      </Link>
    );
  };

  const links = (
    <>
      {link('/', 'Home', () => setOpen(false))}
      {link('/features', 'Features', () => setOpen(false))}
      {link('/pricing', 'Pricing', () => setOpen(false))}
      {link('/about', 'About', () => setOpen(false))}
      {contactPageEnabled !== false && link('/contact', 'Contact', () => setOpen(false))}
    </>
  );

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--bg)_84%,transparent)] backdrop-blur-[18px]">
      <div className="flow-container flex min-h-[68px] items-center gap-2 py-3 sm:gap-4">
        <SiteBrand />
        <nav className="hidden items-center gap-0.5 md:flex">{links}</nav>
        <div className="flex-1" />
        <ThemeToggle />
        {user ? (
          <>
            {user.role === 'ADMIN' && (
              <Link href="/admin" className="btn-secondary !px-3 !py-2 text-xs hidden sm:inline-flex">
                Admin
              </Link>
            )}
            <Link href="/dashboard" className="btn-secondary !px-4 !py-2">
              Dashboard
            </Link>
          </>
        ) : (
          <>
            <Link href="/auth/login" className="btn-secondary !px-4 !py-2 hidden sm:inline-flex">
              Sign in
            </Link>
            <Link href="/auth/register" className="btn-primary !px-[18px] !py-2">
              Start free
            </Link>
          </>
        )}
        <button
          type="button"
          className="rounded-lg p-2 text-[var(--ink2)] hover:bg-[var(--bg2)] md:hidden"
          aria-label="Menu"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-[var(--line)] bg-[var(--bg)] px-5 py-4 md:hidden">
          <nav className="flex flex-col gap-1">{links}</nav>
          {!user && (
            <Link href="/auth/login" className="btn-secondary mt-3 w-full !py-2.5 sm:hidden" onClick={() => setOpen(false)}>
              Sign in
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
