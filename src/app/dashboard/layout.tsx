'use client';

import { useEffect, useMemo, useState } from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Sparkles,
  Image as ImageIcon,
  CreditCard,
  LogOut,
  LayoutDashboard,
  Settings,
  Shield,
  LifeBuoy,
  Menu,
  X,
} from 'lucide-react';
import SiteBrand from '@/components/SiteBrand';
import AnnouncementSocialIcons from '@/components/AnnouncementSocialIcons';
import { useTheme } from '@/components/ThemeProvider';
import { useSiteSettings } from '@/components/SiteSettingsProvider';

interface UserData {
  id: string;
  email: string;
  name: string;
  role: string;
  plan: string;
  maxParallel: number;
  wallets: {
    standard: { available: number; total: number; reserved: number };
    pro: { available: number; total: number; reserved: number };
  };
}

type NoticeItem = {
  id: string;
  title: string;
  body: string;
  severity: 'INFO' | 'WARNING' | 'SUCCESS';
};

const TITLES: Record<string, string> = {
  '/dashboard': 'Overview',
  '/dashboard/create': 'Create',
  '/dashboard/studio': 'Studio',
  '/dashboard/library': 'Library',
  '/dashboard/characters': 'Library',
  '/dashboard/billing': 'Billing & plan',
  '/dashboard/support': 'Support',
  '/dashboard/settings': 'Settings',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const { ticketSystemEnabled, socialLinks } = useSiteSettings();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [mobileNav, setMobileNav] = useState(false);

  const fetchUser = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) {
        router.push('/auth/login');
        return;
      }
      const data = await res.json();
      if (data.authenticated && data.user) setUserData(data.user);
    } catch {
      router.push('/auth/login');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
    const interval = setInterval(fetchUser, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetch('/api/notices')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.notices) setNotices(data.notices);
      })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  const navItems = [
    { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Create', href: '/dashboard/create', icon: Sparkles },
    { name: 'Library', href: '/dashboard/library', icon: ImageIcon },
    { name: 'Billing & plan', href: '/dashboard/billing', icon: CreditCard },
    ...(ticketSystemEnabled
      ? [{ name: 'Support', href: '/dashboard/support', icon: LifeBuoy }]
      : []),
    { name: 'Settings', href: '/dashboard/settings', icon: Settings },
  ];

  const credits = useMemo(() => {
    if (!userData) return { available: 0, total: 0, pct: 0 };
    const available =
      (userData.wallets?.standard?.available || 0) + (userData.wallets?.pro?.available || 0);
    const total =
      Math.max(userData.wallets?.standard?.total || 0, userData.wallets?.standard?.available || 0) +
      Math.max(userData.wallets?.pro?.total || 0, userData.wallets?.pro?.available || 0);
    const denom = total > 0 ? total : Math.max(available, 1);
    return {
      available,
      total: denom,
      pct: Math.min(100, Math.round((available / denom) * 100)),
    };
  }, [userData]);

  const initials = (userData?.name || userData?.email || 'U')
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');

  const title =
    Object.entries(TITLES).find(([path]) =>
      path === '/dashboard' ? pathname === '/dashboard' : pathname?.startsWith(path)
    )?.[1] || 'Dashboard';

  // Studio: full-bleed generation UI only — no escape bar
  if (pathname?.startsWith('/dashboard/studio')) {
    return (
      <div className="h-[100dvh] w-screen max-w-[100vw] overflow-hidden bg-[#090b10]">
        {children}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-sm text-[var(--ink3)]">
        Loading workspace…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <aside className="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-[var(--line)] bg-[var(--bg)] p-4 lg:flex">
        <SiteBrand href="/dashboard" compact />

        <nav className="flex flex-col gap-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname?.startsWith(item.href);
            return (
              <NextLink
                key={item.href}
                href={item.href}
                className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-sm font-medium transition"
                style={{
                  background: active ? 'var(--card)' : 'transparent',
                  color: active ? 'var(--ink)' : 'var(--ink2)',
                }}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.name}
              </NextLink>
            );
          })}
        </nav>

        <div className="flex flex-col gap-2.5 rounded-[14px] border border-[var(--line)] bg-[var(--card)] p-4">
          <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
            CREDITS LEFT
          </span>
          <span className="text-[26px] font-semibold tracking-[-0.03em]">
            {credits.available.toLocaleString()}
          </span>
          <div className="h-[5px] overflow-hidden rounded-full bg-[var(--line)]">
            <div
              className="h-full rounded-full bg-[var(--a1)]"
              style={{ width: `${credits.pct}%` }}
            />
          </div>
          <span className="text-xs text-[var(--ink3)]">
            Std {userData?.wallets.standard.available ?? 0} · Pro{' '}
            {userData?.wallets.pro.available ?? 0}
          </span>
        </div>

        <div className="flex flex-col gap-2 rounded-[14px] border border-[var(--line)] px-4 py-3.5">
          <div className="flex items-center gap-2">
            <span className="block h-[7px] w-[7px] rounded-full bg-[var(--a1)]" />
            <span className="text-[13px] font-medium">API connected</span>
          </div>
          <span className="text-xs leading-relaxed text-[var(--ink3)]">
            Direct API · no session to expire
          </span>
        </div>

        <div className="mt-auto flex flex-col gap-3">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex items-center gap-2 rounded-[10px] border border-[var(--line)] px-3 py-2.5 text-[13px] font-medium text-[var(--ink2)] hover:text-[var(--ink)]"
          >
            <span className="text-base leading-none">{theme === 'dark' ? '☀' : '☾'}</span>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>

          {userData?.role === 'ADMIN' && (
            <NextLink
              href="/admin"
              className="flex items-center gap-2 rounded-[10px] px-3 py-2 text-[13px] font-medium text-[var(--ink2)] hover:text-[var(--ink)]"
            >
              <Shield className="h-4 w-4" />
              Admin
            </NextLink>
          )}

          <div className="flex items-center gap-2.5 border-t border-[var(--line)] px-1.5 pb-1 pt-3.5">
            <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-[var(--a2soft)] font-mono text-[11px] font-medium text-[var(--a2)]">
              {initials || 'U'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">
                {userData?.name || 'Creator'}
              </span>
              <span className="block text-[11px] text-[var(--ink3)]">
                {userData?.plan || 'Free'} plan
              </span>
            </span>
            <button
              type="button"
              onClick={handleLogout}
              title="Sign out"
              className="rounded-lg p-1.5 text-[var(--ink3)] hover:text-[var(--ink)]"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile-only nav */}
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3 lg:hidden">
          <button
            type="button"
            className="rounded-lg p-2 text-[var(--ink2)] hover:bg-[var(--bg2)]"
            aria-label="Menu"
            onClick={() => setMobileNav(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <h2 className="text-[15px] font-semibold tracking-[-0.02em]">{title}</h2>
        </div>

        {mobileNav && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/60"
              aria-label="Close menu"
              onClick={() => setMobileNav(false)}
            />
            <div className="absolute left-0 top-0 flex h-full w-[min(86vw,280px)] flex-col gap-3 overflow-y-auto border-r border-[var(--line)] bg-[var(--bg)] p-4 shadow-xl">
              <div className="flex items-center justify-between">
                <SiteBrand href="/dashboard" compact />
                <button type="button" className="rounded-lg p-2" onClick={() => setMobileNav(false)}>
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex flex-col gap-0.5">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active =
                    item.href === '/dashboard'
                      ? pathname === '/dashboard'
                      : pathname?.startsWith(item.href);
                  return (
                    <NextLink
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileNav(false)}
                      className="flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-sm font-medium"
                      style={{
                        background: active ? 'var(--card)' : 'transparent',
                        color: active ? 'var(--ink)' : 'var(--ink2)',
                      }}
                    >
                      <Icon className="h-4 w-4" />
                      {item.name}
                    </NextLink>
                  );
                })}
              </nav>
            </div>
          </div>
        )}

        <div className="mx-auto flex w-full max-w-[1550px] flex-1 flex-col gap-4 p-4 sm:gap-5 sm:p-[clamp(16px,2.4vw,28px)]">
          {(notices.length > 0 || (socialLinks && Object.keys(socialLinks).length > 0)) && (
            <div className="flex flex-col gap-2.5">
              {notices.map((n, idx) => {
                const colors =
                  n.severity === 'WARNING'
                    ? { bg: 'var(--a2soft)', border: 'var(--a2)', ink: 'var(--a2)' }
                    : n.severity === 'SUCCESS'
                      ? { bg: 'var(--a1soft)', border: 'var(--a1)', ink: 'var(--a1)' }
                      : { bg: 'var(--card)', border: 'var(--line)', ink: 'var(--ink2)' };
                const isLast = idx === notices.length - 1;
                return (
                  <div
                    key={n.id}
                    className="rounded-[14px] border px-4 py-3"
                    style={{ background: colors.bg, borderColor: colors.border }}
                  >
                    <p className="text-sm font-semibold" style={{ color: colors.ink }}>
                      {n.title}
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-[var(--ink2)]">{n.body}</p>
                    {isLast && <AnnouncementSocialIcons links={socialLinks} className="mt-3" />}
                  </div>
                );
              })}
              {notices.length === 0 && (
                <div className="rounded-[14px] border border-[var(--line)] bg-[var(--card)] px-4 py-3">
                  <AnnouncementSocialIcons links={socialLinks} />
                </div>
              )}
            </div>
          )}
          <div className="hidden items-center justify-between gap-3 lg:flex">
            <h2 className="text-[17px] font-semibold tracking-[-0.02em]">{title}</h2>
            <NextLink href="/dashboard/create" className="btn-primary !px-4 !py-2 !text-[13px]">
              New generation
            </NextLink>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
