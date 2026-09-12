'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import {
  ANALYTICS_RANGES,
  AnalyticsRange,
  parseAnalyticsRange,
} from '@/lib/analytics-range';
import { BarChart, DonutSplit, DualBarChart, HBarList } from '@/components/admin/MiniCharts';

type RankItem = { key: string; count: number };

interface AnalyticsPayload {
  range: AnalyticsRange;
  paidByAdmin?: {
    adminId: string;
    name: string;
    email: string;
    role: string;
    paidUsersMonth: number;
    revenueMonth?: number;
    plans?: { name: string; count: number }[];
  }[];
  revenue?: {
    totalMonth: number;
    byAdmin: { adminId: string; name: string; email: string; revenueMonth: number }[];
  };
  users: {
    totalUsers: number;
    activeUsersMonth: number;
    paidPlanUsers: number;
    activeSubscriptions: number;
    newUsersInRange: number;
    newPaidUsersInRange: number;
    onlineNow: number;
  };
  plans: {
    breakdown: { planId: string; name: string; count: number; paid: boolean }[];
  };
  live: {
    activeUsersNow: number;
    activeUsers: { id: string; name: string | null; email: string; jobs: number }[];
    activeJobsNow: number;
    inQueue: number;
    inProgress: number;
  };
  generations: {
    total: number;
    images: number;
    videos: number;
    completed: number;
    failed: number;
    successRate: number;
    failureRate: number;
  };
  breakdowns: {
    tools: RankItem[];
    methods: RankItem[];
    models: RankItem[];
  };
  series: {
    generationsDaily: { date: string; total: number; images: number; videos: number }[];
    newUsersDaily: { date: string; count: number }[];
  };
}

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

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {hint && <p className="mt-0.5 text-[12px] text-[var(--ink3)]">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function jobsHref(range: AnalyticsRange, status?: string) {
  const q = new URLSearchParams({ range });
  if (status) q.set('status', status);
  return `/admin/jobs?${q.toString()}`;
}

export default function AdminOverviewPage() {
  const [range, setRange] = useState<AnalyticsRange>('today');
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveOpen, setLiveOpen] = useState(false);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/analytics?range=${range}`);
      if (res.ok) {
        const json = await res.json();
        setData(json as AnalyticsPayload);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    setLoading(true);
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 10000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  const showNewUserChart = range === '7d' || range === '30d';

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--ink3)]">
          Split dates · live ops · range charts — refreshes every 10s
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {ANALYTICS_RANGES.map((r) => {
              const active = range === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRange(parseAnalyticsRange(r.id))}
                  className="rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors"
                  style={{
                    borderColor: active ? 'var(--a1)' : 'var(--line)',
                    background: active ? 'var(--a1soft)' : 'transparent',
                    color: active ? 'var(--ink)' : 'var(--ink2)',
                  }}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
          <button type="button" onClick={fetchMetrics} className="btn-secondary !px-3 !py-2 !text-xs">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {loading && !data ? (
        <p className="text-sm text-[var(--ink3)]">Loading metrics…</p>
      ) : data ? (
        <>
          {data.paidByAdmin && data.paidByAdmin.length > 0 && (
            <Section title="Paid users by admin" hint="Sub-admins only · calendar month · plan mix under each card">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {data.paidByAdmin.map((a) => (
                  <Link
                    key={a.adminId}
                    href={`/admin/users?owner=${a.adminId}`}
                    className="flex flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 transition-colors hover:border-[var(--a1)]"
                  >
                    <div>
                      <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                        {a.name.toUpperCase()}
                      </span>
                      <div className="mt-1 text-[28px] font-semibold tracking-[-0.035em]">
                        {a.paidUsersMonth}
                      </div>
                      <span className="text-xs text-[var(--ink3)]">Admin · this month</span>
                    </div>
                    {a.plans && a.plans.length > 0 ? (
                      <ul className="flex flex-col gap-1.5 border-t border-[var(--line)] pt-3">
                        {a.plans.map((p) => (
                          <li
                            key={p.name}
                            className="flex items-center justify-between gap-2 text-[12px]"
                          >
                            <span className="text-[var(--ink2)]">{p.name}</span>
                            <span className="font-mono font-semibold text-[var(--ink)]">{p.count}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="border-t border-[var(--line)] pt-3 text-[12px] text-[var(--ink3)]">
                        No paid plans this month
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            </Section>
          )}

          <Section
            title="Revenue this month"
            hint="Admin-direct = user display price · Reseller users = wholesale price given to reseller · same-day removals excluded"
          >
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-2 rounded-2xl border border-[var(--a1)] bg-[var(--card)] p-5">
                <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                  TOTAL REVENUE
                </span>
                <span className="text-[28px] font-semibold tracking-[-0.035em]">
                  $
                  {Number(data.revenue?.totalMonth || 0).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs text-[var(--ink3)]">All counted deals · this month</span>
              </div>
              {(data.revenue?.byAdmin || []).map((a) => (
                <div
                  key={a.adminId}
                  className="flex flex-col gap-2 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5"
                >
                  <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                    {a.name.toUpperCase()}
                  </span>
                  <span className="text-[28px] font-semibold tracking-[-0.035em]">
                    $
                    {Number(a.revenueMonth || 0).toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <span className="text-xs text-[var(--ink3)]">Admin revenue · this month</span>
                </div>
              ))}
            </div>
          </Section>

          <Section
            title="Users & plans"
            hint="Totals are all-time · active this month & plan mix use calendar month · new* follow the range"
          >
            <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
              <StatCard
                label="TOTAL USERS"
                value={data.users.totalUsers}
                hint="All-time"
                href="/admin/users"
              />
              <StatCard
                label="ACTIVE THIS MONTH"
                value={data.users.activeUsersMonth}
                hint="lastSeenAt in calendar month"
                href="/admin/users?seen=1"
              />
              <StatCard
                label="PAID PLAN USERS"
                value={data.users.paidPlanUsers}
                hint="ACTIVE · price > 0"
                href="/admin/orders"
              />
              <StatCard
                label="ACTIVE SUBSCRIPTIONS"
                value={data.users.activeSubscriptions}
                hint="All-time ACTIVE"
                href="/admin/orders"
              />
              <StatCard
                label="NEW USERS"
                value={data.users.newUsersInRange}
                hint={`Range · ${range}`}
                href={`/admin/users?range=${range}`}
              />
              <StatCard
                label="NEW PAID"
                value={data.users.newPaidUsersInRange}
                hint={`Subs created · ${range}`}
                href={`/admin/orders?range=${range}`}
              />
              <StatCard
                label="ONLINE NOW"
                value={data.users.onlineNow}
                hint="Seen in last 15m"
                href="/admin/users?seen=1"
              />
            </div>

            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
              <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                PLAN BREAKDOWN · THIS MONTH
              </span>
              {data.plans.breakdown.length === 0 ? (
                <p className="mt-3 text-xs text-[var(--ink3)]">No active subscriptions this month</p>
              ) : (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {data.plans.breakdown.map((p) => (
                    <li
                      key={p.planId}
                      className="flex items-baseline justify-between gap-2 rounded-xl border border-[var(--line)] px-3 py-2.5"
                    >
                      <span className="text-[13px]">
                        {p.name}
                        {!p.paid && (
                          <span className="ml-1.5 text-[10px] uppercase text-[var(--ink3)]">free</span>
                        )}
                      </span>
                      <span className="font-mono text-[15px] font-semibold">{p.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>

          <Section title="Live now" hint="Users with queued or running jobs right now">
            <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
              <StatCard
                label="ACTIVE USERS NOW"
                value={data.live.activeUsersNow}
                href={jobsHref(range, 'ACTIVE')}
              />
              <StatCard
                label="ACTIVE JOBS"
                value={data.live.activeJobsNow}
                href={jobsHref(range, 'ACTIVE')}
              />
              <StatCard label="IN QUEUE" value={data.live.inQueue} href={jobsHref(range, 'IN_QUEUE')} />
              <StatCard
                label="IN PROGRESS"
                value={data.live.inProgress}
                hint="Preparing / generating"
                href={jobsHref(range, 'ACTIVE')}
              />
            </div>

            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)]">
              <button
                type="button"
                onClick={() => setLiveOpen((o) => !o)}
                className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
              >
                <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                  ACTIVE USERS LIST · {data.live.activeUsers.length}
                </span>
                {liveOpen ? (
                  <ChevronDown className="h-4 w-4 text-[var(--ink3)]" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-[var(--ink3)]" />
                )}
              </button>
              {liveOpen && (
                <ul className="max-h-72 divide-y divide-[var(--line)] overflow-y-auto border-t border-[var(--line)]">
                  {data.live.activeUsers.length === 0 ? (
                    <li className="px-5 py-4 text-xs text-[var(--ink3)]">Nobody generating right now</li>
                  ) : (
                    data.live.activeUsers.map((u) => (
                      <li key={u.id}>
                        <Link
                          href={`/admin/users/${u.id}`}
                          className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-[var(--a1soft)]"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-medium">
                              {u.name || u.email}
                            </div>
                            {u.name && (
                              <div className="truncate text-[11px] text-[var(--ink3)]">{u.email}</div>
                            )}
                          </div>
                          <span className="shrink-0 font-mono text-[11px] text-[var(--ink3)]">
                            {u.jobs} job{u.jobs === 1 ? '' : 's'}
                          </span>
                        </Link>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          </Section>

          <Section title="Generations" hint={`Scoped to ${range}`}>
            <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
              <StatCard label="TOTAL GENS" value={data.generations.total} href={jobsHref(range)} />
              <StatCard label="IMAGES" value={data.generations.images} href={jobsHref(range)} />
              <StatCard label="VIDEOS" value={data.generations.videos} href={jobsHref(range)} />
              <StatCard
                label="COMPLETED"
                value={data.generations.completed}
                href={jobsHref(range, 'COMPLETED')}
              />
              <StatCard
                label="FAILED"
                value={data.generations.failed}
                hint="Excludes user stop"
                href={jobsHref(range, 'FAILED')}
              />
              <StatCard
                label="SUCCESS RATE"
                value={`${data.generations.successRate}%`}
                href={jobsHref(range)}
              />
              <StatCard
                label="FAILURE RATE"
                value={`${data.generations.failureRate}%`}
                href={jobsHref(range, 'FAILED')}
              />
            </div>
          </Section>

          <Section title="Usage breakdowns" hint={`Top tools · methods · models · ${range}`}>
            <div className="grid gap-3.5 lg:grid-cols-3">
              <HBarList
                title="TOOLS"
                items={data.breakdowns.tools.map((t) => ({ label: t.key, value: t.count }))}
              />
              <HBarList
                title="METHODS"
                items={data.breakdowns.methods.map((t) => ({ label: t.key, value: t.count }))}
              />
              <HBarList
                title="MODELS"
                items={data.breakdowns.models.map((t) => ({ label: t.key, value: t.count }))}
              />
            </div>
          </Section>

          <Section title="Charts" hint={`Daily series for ${range}`}>
            <div className="grid gap-3.5 lg:grid-cols-2">
              <BarChart
                title="GENERATIONS / DAY"
                points={data.series.generationsDaily.map((d) => ({
                  date: d.date,
                  value: d.total,
                }))}
              />
              <DualBarChart
                title="IMAGES VS VIDEOS / DAY"
                points={data.series.generationsDaily.map((d) => ({
                  date: d.date,
                  a: d.images,
                  b: d.videos,
                }))}
              />
              <DonutSplit
                title="IMAGES VS VIDEOS"
                a={data.generations.images}
                b={data.generations.videos}
              />
              <HBarList
                title="TOP MODELS"
                items={data.breakdowns.models.map((t) => ({ label: t.key, value: t.count }))}
                maxItems={6}
              />
              <HBarList
                title="TOP TOOLS"
                items={data.breakdowns.tools.map((t) => ({ label: t.key, value: t.count }))}
                maxItems={6}
              />
              {showNewUserChart ? (
                <BarChart
                  title="NEW USERS / DAY"
                  points={data.series.newUsersDaily.map((d) => ({
                    date: d.date,
                    value: d.count,
                  }))}
                />
              ) : (
                <div className="flex flex-col justify-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
                  <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                    NEW USERS ({range})
                  </span>
                  <span className="text-[28px] font-semibold tracking-tight">
                    {data.users.newUsersInRange}
                  </span>
                  <span className="text-xs text-[var(--ink3)]">
                    Switch to 7d / 30d for a daily chart
                  </span>
                </div>
              )}
            </div>
          </Section>

          <div className="rounded-2xl border border-dashed border-[var(--line)] px-5 py-4 text-center text-[12px] text-[var(--ink3)]">
            More cards coming soon
          </div>
        </>
      ) : (
        <p className="text-sm text-rose-400">Could not load analytics.</p>
      )}
    </div>
  );
}
