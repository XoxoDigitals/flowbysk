'use client';

import { useEffect, useState } from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Users,
  Server,
  Activity,
  ShieldAlert,
  Settings,
  LogOut,
  Layers,
  ShoppingBag,
  Menu,
  X,
  ScrollText,
} from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import { clearSession, flowFetch, readSession } from '@/lib/flowApi';

const BLOCKED_PREFIXES = [
  '/admin/orders',
  '/admin/jobs',
  '/admin/messages',
  '/admin/tickets',
  '/admin/stripe',
  '/admin/studio-logs',
  '/admin/logs/proxies',
];

const TITLES: Record<string, string> = {
  '/admin': 'Overview',
  '/admin/users': 'Users',
  '/admin/accounts': 'Accounts',
  '/admin/resellers': 'Resellers',
  '/admin/system-users': 'System Users',
  '/admin/plans': 'Plans',
  '/admin/logs': 'Logs',
  '/admin/settings': 'Settings',
};

function pageTitle(pathname: string | null) {
  if (!pathname) return 'Admin';
  if (pathname.match(/^\/admin\/users\/[^/]+$/)) return 'User detail';
  return TITLES[pathname] || 'Admin';
}

const NAV = [
  { name: 'Overview', href: '/admin', icon: Activity },
  { name: 'Users', href: '/admin/users', icon: Users },
  { name: 'Accounts', href: '/admin/accounts', icon: Server },
  { name: 'Resellers', href: '/admin/resellers', icon: ShoppingBag },
  { name: 'System Users', href: '/admin/system-users', icon: ShieldAlert },
  { name: 'Plans', href: '/admin/plans', icon: Layers },
  { name: 'Logs', href: '/admin/logs', icon: ScrollText },
  { name: 'Settings', href: '/admin/settings', icon: Settings },
];

function clearPrismaCookie() {
  try {
    document.cookie = 'saas_token=; Path=/; Max-Age=0; SameSite=Lax';
  } catch {
    /* ignore */
  }
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [ready, setReady] = useState(false);
  const [adminName, setAdminName] = useState('Admin');
  const [mobileNav, setMobileNav] = useState(false);
  const [brand, setBrand] = useState('Flow Creator Ai');

  useEffect(() => {
    clearPrismaCookie();
    document.title = 'Flow Creator Ai Admin';

    const session = readSession();
    if (!session?.token || session.role !== 'admin') {
      router.replace('/auth/login');
      return;
    }

    setAdminName(session.username || 'Admin');

    if (BLOCKED_PREFIXES.some((p) => pathname?.startsWith(p))) {
      router.replace('/admin');
      return;
    }

    flowFetch('/api/admin/metrics')
      .then(async (res) => {
        if (!res.ok) {
          clearSession();
          router.replace('/auth/login');
          return;
        }
        setReady(true);
      })
      .catch(() => {
        clearSession();
        router.replace('/auth/login');
      });

    flowFetch('/api/admin/settings')
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        const name = data?.settings?.siteName || data?.settings?.appName;
        if (name) {
          setBrand(String(name));
          document.title = `${name} Admin`;
        }
      })
      .catch(() => {});
  }, [router, pathname]);

  const handleLogout = () => {
    clearSession();
    clearPrismaCookie();
    router.push('/auth/login');
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-sm text-[var(--ink3)]">
        Verifying Flow Creator Ai admin…
      </div>
    );
  }

  const title = pageTitle(pathname);

  const initials = adminName
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');

  const navLink = (item: (typeof NAV)[number], onClick?: () => void) => {
    const Icon = item.icon;
    const active =
      item.href === '/admin' ? pathname === '/admin' : pathname?.startsWith(item.href);
    return (
      <NextLink
        key={item.href}
        href={item.href}
        onClick={onClick}
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
  };

  return (
    <div className="flex min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <aside className="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-[var(--line)] bg-[var(--bg)] p-4 lg:flex">
        <div className="flex items-center gap-2 px-1">
          <span className="block h-[22px] w-[22px] rounded-[7px] bg-gradient-to-br from-[var(--a1)] to-[var(--a2)]" />
          <span className="text-[17px] font-semibold tracking-[-0.02em]">{brand}</span>
          <span className="rounded-lg bg-[var(--a1soft)] px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-[var(--a1)]">
            ADMIN
          </span>
        </div>

        <nav className="flex flex-col gap-0.5">{NAV.map((item) => navLink(item))}</nav>

        <div className="mt-auto flex flex-col gap-3">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex items-center gap-2 rounded-[10px] border border-[var(--line)] px-3 py-2.5 text-[13px] font-medium text-[var(--ink2)] hover:text-[var(--ink)]"
          >
            <span className="text-base leading-none">{theme === 'dark' ? '☀' : '☾'}</span>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>

          <div className="flex items-center gap-2.5 border-t border-[var(--line)] px-1.5 pb-1 pt-3.5">
            <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-[var(--a2soft)] font-mono text-[11px] font-medium text-[var(--a2)]">
              {initials || 'A'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{adminName}</span>
              <span className="block text-[11px] text-[var(--ink3)]">Express API · :3000</span>
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
                <span className="text-[17px] font-semibold">{brand}</span>
                <button type="button" className="rounded-lg p-2" onClick={() => setMobileNav(false)}>
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex flex-col gap-0.5">
                {NAV.map((item) => navLink(item, () => setMobileNav(false)))}
              </nav>
            </div>
          </div>
        )}

        <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-5 p-[clamp(16px,2.4vw,28px)]">
          <h2 className="hidden text-[17px] font-semibold tracking-[-0.02em] lg:block">{title}</h2>
          {children}
        </div>
      </div>
    </div>
  );
}
