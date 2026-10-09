'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { flowFetch } from '@/lib/flowApi';
import { formatPeriodWindow } from '@/lib/adminLogFormat';

type ServerMetric = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  hasTotp: boolean;
  assignedUserCount: number;
};

type PeriodStats = {
  periodStart?: string;
  periodEnd?: string;
  newUsers?: number;
  renewals?: number;
  total?: number;
  error?: string;
};

type Metrics = {
  totalUsers: number;
  activeUsers: number;
  expiredUsers: number;
  totalCredits: number;
  totalServers: number;
  activeServers: number;
  resellers: number;
  systemUsers: number;
  adminUserCounts?: {
    id: string;
    username: string;
    displayName?: string;
    userCount: number;
    periodNew?: number;
    periodRenewals?: number;
    periodTotal?: number;
  }[];
  period?: PeriodStats | null;
  servers: ServerMetric[];
};

function StatCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">{label}</span>
      <span className="text-[28px] font-semibold tracking-[-0.035em]">{value}</span>
      {hint && <span className="text-xs text-[var(--ink3)]">{hint}</span>}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="flex flex-col gap-2 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 transition-colors hover:border-[var(--a1)]"
      >
        {body}
      </Link>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
      {body}
    </div>
  );
}

export default function AdminOverviewPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await flowFetch('/api/admin/metrics');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load metrics');
      setMetrics(data.metrics as Metrics);
      setError('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load metrics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--ink3)]">
          Flow Creator Ai API · live pool status · refreshes every 15s
        </p>
        <button type="button" onClick={load} className="btn-secondary !px-3 !py-2 !text-xs">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
          {error}
        </p>
      )}

      {loading && !metrics ? (
        <p className="text-sm text-[var(--ink3)]">Loading Express metrics…</p>
      ) : metrics ? (
        <>
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard label="END USERS" value={metrics.totalUsers} href="/admin/users" />
            <StatCard label="ACTIVE PLANS" value={metrics.activeUsers} href="/admin/users" />
            <StatCard label="EXPIRED" value={metrics.expiredUsers} />
            <StatCard label="TOTAL CREDITS" value={metrics.totalCredits.toLocaleString()} />
            <StatCard
              label="GOOGLE ACCOUNTS"
              value={metrics.totalServers}
              hint={`${metrics.activeServers} active`}
              href="/admin/accounts"
            />
            <StatCard label="RESELLERS" value={metrics.resellers} href="/admin/resellers" />
            <StatCard label="SYSTEM USERS" value={metrics.systemUsers} href="/admin/system-users" />
          </div>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight">
                  Billing period (10th → 10th UTC)
                </h2>
                <p className="mt-0.5 text-[12px] text-[var(--ink3)]">
                  New users vs renewals in the current window
                </p>
              </div>
              <span className="rounded-md bg-[var(--bg2)] px-2.5 py-1 font-mono text-[11px] text-[var(--ink2)]">
                {metrics.period && !metrics.period.error
                  ? formatPeriodWindow(metrics.period.periodStart, metrics.period.periodEnd)
                  : '—'}
              </span>
            </div>
            {metrics.period?.error ? (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                Period stats unavailable: {metrics.period.error}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
                <StatCard
                  label="NEW USERS"
                  value={metrics.period?.newUsers ?? 0}
                  href="/admin/users"
                />
                <StatCard label="RENEWALS" value={metrics.period?.renewals ?? 0} />
                <StatCard label="PERIOD TOTAL" value={metrics.period?.total ?? 0} />
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Admins by owned users</h2>
              <p className="mt-0.5 text-[12px] text-[var(--ink3)]">
                All-time owned users · new / renewals in the current 10th→10th window
              </p>
            </div>
            <div className="overflow-hidden rounded-2xl border border-[var(--line)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--bg2)] text-[11px] uppercase tracking-wider text-[var(--ink3)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Admin</th>
                    <th className="px-4 py-3 font-medium">Users</th>
                    <th className="px-4 py-3 font-medium">Period new</th>
                    <th className="px-4 py-3 font-medium">Period renew</th>
                    <th className="px-4 py-3 font-medium">Period total</th>
                  </tr>
                </thead>
                <tbody>
                  {(metrics.adminUserCounts || []).map((a) => (
                    <tr key={a.id} className="border-t border-[var(--line)]">
                      <td className="px-4 py-3">
                        <Link href="/admin/system-users" className="font-medium hover:text-[var(--a1)]">
                          {a.displayName || a.username}
                        </Link>
                        {a.displayName ? (
                          <div className="text-[11px] text-[var(--ink3)]">{a.username}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-mono">{a.userCount}</td>
                      <td className="px-4 py-3 font-mono">{a.periodNew ?? 0}</td>
                      <td className="px-4 py-3 font-mono">{a.periodRenewals ?? 0}</td>
                      <td className="px-4 py-3 font-mono">{a.periodTotal ?? 0}</td>
                    </tr>
                  ))}
                  {!(metrics.adminUserCounts || []).length && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-[var(--ink3)]">
                        No admin counts
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Google shared accounts</h2>
              <p className="mt-0.5 text-[12px] text-[var(--ink3)]">
                Assigned end-user counts · TOTP readiness
              </p>
            </div>
            <div className="overflow-hidden rounded-2xl border border-[var(--line)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--bg2)] text-[11px] uppercase tracking-wider text-[var(--ink3)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Account</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">TOTP</th>
                    <th className="px-4 py-3 font-medium">Assigned</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(metrics.servers || []).map((s) => (
                    <tr key={s.id} className="border-t border-[var(--line)]">
                      <td className="px-4 py-3 font-medium">
                        <Link href="/admin/accounts" className="hover:text-[var(--a1)]">
                          {s.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[var(--ink2)]">{s.email || '—'}</td>
                      <td className="px-4 py-3">
                        {s.hasTotp ? (
                          <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                            Ready
                          </span>
                        ) : (
                          <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
                            Missing
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono">{s.assignedUserCount}</td>
                      <td className="px-4 py-3">
                        {s.isActive ? (
                          <span className="text-emerald-400">Active</span>
                        ) : (
                          <span className="text-[var(--ink3)]">Off</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!metrics.servers?.length && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-[var(--ink3)]">
                        No Google accounts yet — add one under Accounts.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
