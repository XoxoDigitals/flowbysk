'use client';

import { useEffect, useState } from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Users,
  Server,
  Activity,
  ArrowLeft,
  ListOrdered,
  ShoppingBag,
  ShieldAlert,
  Settings,
  LogOut,
  Layers,
  CreditCard,
  Mail,
  LifeBuoy,
  Menu,
  X,
  Terminal,
} from 'lucide-react';
import SiteBrand from '@/components/SiteBrand';
import { useTheme } from '@/components/ThemeProvider';

const TITLES: Record<string, string> = {
  '/admin': 'Overview',
  '/admin/users': 'Users',
  '/admin/orders': 'Orders',
  '/admin/accounts': 'Accounts',
  '/admin/jobs': 'Jobs',
  '/admin/logs': 'Logs',
  '/admin/studio-logs': 'Studio Logs',
  '/admin/plans': 'Plans',
  '/admin/stripe': 'Stripe',
  '/admin/messages': 'Messages',
  '/admin/tickets': 'Tickets',
  '/admin/settings': 'Settings',
  '/admin/system-users': 'System Users',
  '/admin/resellers': 'Resellers',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adminName, setAdminName] = useState('Admin');
  const [adminRole, setAdminRole] = useState('ADMIN');
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const role = data?.user?.role;
        if (!data?.authenticated || (role !== 'ADMIN' && role !== 'SUPER_ADMIN')) {
          if (role === 'RESELLER') router.push('/reseller');
          else router.push('/dashboard');
        } else {
          setIsAdmin(true);
          setAdminRole(role);
          setAdminName(data.user?.name || data.user?.email || 'Admin');
        }
      })
      .catch(() => router.push('/dashboard'))
      .finally(() => setLoading(false));
  }, [router]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] text-sm text-[var(--ink3)]">
        Verifying administrator access…
      </div>
    );
  }

  if (!isAdmin) return null;

  const adminNav = [
    { name: 'Overview', href: '/admin', icon: Activity },
    { name: 'Users', href: '/admin/users', icon: Users },
    { name: 'Resellers', href: '/admin/resellers', icon: ShoppingBag },
    ...(adminRole === 'SUPER_ADMIN'
      ? [{ name: 'System Users', href: '/admin/system-users', icon: ShieldAlert }]
      : []),
    { name: 'Orders', href: '/admin/orders', icon: ShoppingBag },
    { name: 'Accounts', href: '/admin/accounts', icon: Server },
    { name: 'Jobs', href: '/admin/jobs', icon: ListOrdered },
    { name: 'Plans', href: '/admin/plans', icon: Layers },
    { name: 'Messages', href: '/admin/messages', icon: Mail },
    { name: 'Tickets', href: '/admin/tickets', icon: LifeBuoy },
    { name: 'Stripe', href: '/admin/stripe', icon: CreditCard },
    { name: 'Logs', href: '/admin/logs', icon: ShieldAlert },
    { name: 'Studio Logs', href: '/admin/studio-logs', icon: Terminal },
    { name: 'Settings', href: '/admin/settings', icon: Settings },
  ];

  const title =
    Object.entries(TITLES).find(([path]) =>
      path === '/admin' ? pathname === '/admin' : pathname?.startsWith(path)
    )?.[1] || 'Admin';

  const initials = adminName
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');

  return (
    <div className="flex min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <aside className="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-[var(--line)] bg-[var(--bg)] p-4 lg:flex">
        <div className="flex items-center gap-2 px-1">
          <SiteBrand href="/admin" compact />
          <span className="rounded-lg bg-[var(--a1soft)] px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-[var(--a1)]">
            {adminRole === 'SUPER_ADMIN' ? 'SUPER' : 'ADMIN'}
          </span>
        </div>

        <nav className="flex flex-col gap-0.5">
          {adminNav.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === '/admin'
                ? pathname === '/admin'
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

        <div className="mt-auto flex flex-col gap-3">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex items-center gap-2 rounded-[10px] border border-[var(--line)] px-3 py-2.5 text-[13px] font-medium text-[var(--ink2)] hover:text-[var(--ink)]"
          >
            <span className="text-base leading-none">{theme === 'dark' ? '☀' : '☾'}</span>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>

          <NextLink
            href="/dashboard"
            className="flex items-center gap-2 rounded-[10px] px-3 py-2 text-[13px] font-medium text-[var(--ink2)] hover:text-[var(--ink)]"
          >
            <ArrowLeft className="h-4 w-4" />
            User dashboard
          </NextLink>

          <div className="flex items-center gap-2.5 border-t border-[var(--line)] px-1.5 pb-1 pt-3.5">
            <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-[var(--a2soft)] font-mono text-[11px] font-medium text-[var(--a2)]">
              {initials || 'A'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{adminName}</span>
              <span className="block text-[11px] text-[var(--ink3)]">Administrator</span>
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
                <SiteBrand href="/admin" compact />
                <button type="button" className="rounded-lg p-2" onClick={() => setMobileNav(false)}>
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex flex-col gap-0.5">
                {adminNav.map((item) => {
                  const Icon = item.icon;
                  const active =
                    item.href === '/admin'
                      ? pathname === '/admin'
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

        <div className="mx-auto flex w-full max-w-[1550px] flex-1 flex-col gap-5 p-[clamp(16px,2.4vw,28px)]">
          <h2 className="hidden text-[17px] font-semibold tracking-[-0.02em] lg:block">{title}</h2>
          {children}
        </div>
      </div>
    </div>
  );
}
