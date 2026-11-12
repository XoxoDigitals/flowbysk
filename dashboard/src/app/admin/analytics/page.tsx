'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  Users,
  UserPlus,
  RefreshCw,
  UserMinus,
  Calendar,
  DollarSign,
  Shield,
  Search,
  ArrowLeft,
  Sparkles,
  CreditCard,
} from 'lucide-react';
import { flowFetch } from '@/lib/flowApi';

type PeriodStats = {
  periodStart: string;
  periodEnd: string;
  newUsers: number;
  renewals: number;
  total: number;
  isCurrent?: boolean;
};

type AvailableCycle = {
  offset: number;
  label: string;
  shortLabel: string;
  periodStart: string;
  periodEnd: string;
  isCurrent: boolean;
};

type ActiveUser = {
  id: string;
  username: string;
  email: string;
  displayName: string;
  credits: number;
  createdAt?: string | null;
  planExpiry?: string | null;
  paymentAmount: number;
  paymentStatus: string;
  isPaid: boolean;
  paidAt?: string | null;
  ownerLabel?: string | null;
  planName?: string;
  isActive: boolean;
  banned: boolean;
  cycleType?: 'NEW' | 'RENEWAL';
};

type DeletedUser = {
  id: string;
  username: string;
  email: string;
  displayName?: string;
  adminId: string;
  deletedByAdminId?: string | null;
  createdAt: string;
  deletedAt: string;
  daysUsed: number;
  creditsUsed: number;
  lastCredits: number;
};

type AdminDetail = {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: string;
  periodStats: {
    newUsers: number;
    renewals: number;
    total: number;
  };
  totalManagedUsers: number;
  users: ActiveUser[];
  deletedUsers: DeletedUser[];
};

type DetailedAnalyticsResponse = {
  success: boolean;
  cycleOffset?: number;
  period: PeriodStats;
  availableCycles?: AvailableCycle[];
  admins: AdminDetail[];
  allUsers: ActiveUser[];
  allDeleted: DeletedUser[];
  error?: string;
};

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatDateTime(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function AdminAnalyticsPage() {
  const [data, setData] = useState<DetailedAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [cycleLoading, setCycleLoading] = useState(false);
  const [cycleOffset, setCycleOffset] = useState(0);
  const [error, setError] = useState('');
  const [activeSlide, setActiveSlide] = useState(0); // 0 = Overview / All Admins, 1..N = Admin slides
  const [userQuery, setUserQuery] = useState('');
  const [deletedQuery, setDeletedQuery] = useState('');

  const load = async (offset = 0) => {
    setCycleLoading(true);
    setError('');
    try {
      const res = await flowFetch(`/api/admin/detailed-analytics?offset=${offset}`);
      const d = await res.json();
      if (!res.ok || !d.success) {
        throw new Error(d.error || 'Failed to load admin analytics');
      }
      setData(d);
      setCycleOffset(offset);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
      setCycleLoading(false);
    }
  };

  useEffect(() => {
    load(0);
  }, []);

  const handleCycleChange = (newOffset: number) => {
    const validOffset = Math.max(0, newOffset);
    load(validOffset);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[var(--ink3)]">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin text-[var(--a1)]" />
        Loading Admin Analytics…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-400">
          {error || 'Failed to load analytics.'}
        </div>
        <button onClick={() => load(cycleOffset)} className="btn-secondary !w-fit !text-xs">
          Try Again
        </button>
      </div>
    );
  }

  const { period, availableCycles = [], admins, allUsers, allDeleted } = data;
  const totalSlides = 1 + admins.length; // Slide 0 = All, Slides 1..N = individual admins

  const prevSlide = () => setActiveSlide((curr) => (curr > 0 ? curr - 1 : totalSlides - 1));
  const nextSlide = () => setActiveSlide((curr) => (curr < totalSlides - 1 ? curr + 1 : 0));

  const isOverview = activeSlide === 0;
  const currentAdmin = !isOverview ? admins[activeSlide - 1] : null;

  // Active users to display (strictly users added or renewed in this cycle)
  const rawActiveUsers = isOverview ? allUsers : currentAdmin?.users || [];
  const filteredActiveUsers = rawActiveUsers.filter((u) => {
    if (!userQuery.trim()) return true;
    const q = userQuery.toLowerCase();
    return (
      (u.username || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.displayName || '').toLowerCase().includes(q)
    );
  });

  // Deleted users to display (strictly users removed in this cycle)
  const rawDeletedUsers = isOverview ? allDeleted : currentAdmin?.deletedUsers || [];
  const filteredDeletedUsers = rawDeletedUsers.filter((d) => {
    if (!deletedQuery.trim()) return true;
    const q = deletedQuery.toLowerCase();
    return (
      (d.username || '').toLowerCase().includes(q) ||
      (d.email || '').toLowerCase().includes(q) ||
      (d.displayName || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Header & Cycle Info */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="btn-secondary !px-3 !py-2 !text-xs">
            <ArrowLeft className="h-3.5 w-3.5" />
            Admin Overview
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Admin Detailed Analytics</h1>
            <p className="text-xs text-[var(--ink3)]">
              10th → 10th Monthly Billing &amp; Performance Period · Interactive Slider View
            </p>
          </div>
        </div>

        {/* 10-to-10 Cycle Selector & Controls */}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-2">
          <div className="flex items-center gap-1.5 px-2 text-xs text-[var(--ink3)]">
            <Calendar className="h-4 w-4 text-[var(--a1)]" />
            <span className="font-semibold uppercase tracking-wider text-[11px]">10-to-10 Cycle:</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleCycleChange(cycleOffset + 1)}
              disabled={cycleOffset >= (availableCycles.length - 1) || cycleLoading}
              className="rounded-lg border border-[var(--line)] bg-[var(--bg2)] px-2.5 py-1 text-xs font-medium text-[var(--ink2)] hover:bg-[var(--line)] disabled:opacity-40 disabled:pointer-events-none transition flex items-center gap-1"
              title="Previous 10-to-10 Cycle"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Prev Cycle</span>
            </button>

            <select
              value={cycleOffset}
              disabled={cycleLoading}
              onChange={(e) => handleCycleChange(Number(e.target.value))}
              className="rounded-lg border border-[var(--line)] bg-[var(--bg2)] px-3 py-1 text-xs font-semibold text-[var(--ink)] outline-none focus:border-[var(--a1)] cursor-pointer"
            >
              {availableCycles.map((c) => (
                <option key={c.offset} value={c.offset}>
                  {c.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => handleCycleChange(Math.max(0, cycleOffset - 1))}
              disabled={cycleOffset <= 0 || cycleLoading}
              className="rounded-lg border border-[var(--line)] bg-[var(--bg2)] px-2.5 py-1 text-xs font-medium text-[var(--ink2)] hover:bg-[var(--line)] disabled:opacity-40 disabled:pointer-events-none transition flex items-center gap-1"
              title="Next 10-to-10 Cycle"
            >
              <span>Next Cycle</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <span
            className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
              cycleOffset === 0
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
            }`}
          >
            {cycleOffset === 0 ? 'Current 10-to-10 Cycle' : 'Past Cycle'}
          </span>

          {cycleLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-[var(--a1)]" />}
        </div>
      </div>

      {/* Slider Controls / Admin Switcher Tabs */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink3)]">
              Select Admin Slide:
            </span>
            <span className="font-mono text-xs text-[var(--a1)]">
              Slide {activeSlide + 1} of {totalSlides}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={prevSlide}
              className="btn-secondary !px-2.5 !py-1.5 !text-xs"
              title="Previous Slide"
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </button>
            <button
              type="button"
              onClick={nextSlide}
              className="btn-secondary !px-2.5 !py-1.5 !text-xs"
              title="Next Slide"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Slider pill selector */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
          <button
            type="button"
            onClick={() => setActiveSlide(0)}
            className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition ${
              activeSlide === 0
                ? 'bg-[var(--a1)] text-white shadow-sm'
                : 'bg-[var(--bg2)] text-[var(--ink2)] hover:bg-[var(--line)]'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>All Admins Overview</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                activeSlide === 0 ? 'bg-white/20 text-white' : 'bg-[var(--line)] text-[var(--ink3)]'
              }`}
            >
              {allUsers.length}
            </span>
          </button>

          {admins.map((adm, i) => {
            const slideIdx = i + 1;
            const isCurrent = activeSlide === slideIdx;
            return (
              <button
                key={adm.id}
                type="button"
                onClick={() => setActiveSlide(slideIdx)}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition ${
                  isCurrent
                    ? 'bg-[var(--a1)] text-white shadow-sm'
                    : 'bg-[var(--bg2)] text-[var(--ink2)] hover:bg-[var(--line)]'
                }`}
              >
                <Shield className="h-3.5 w-3.5" />
                <span>{adm.displayName || adm.username}</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                    isCurrent ? 'bg-white/20 text-white' : 'bg-[var(--line)] text-[var(--ink3)]'
                  }`}
                >
                  {adm.periodStats.total}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Slide Content */}
      {isOverview ? (
        /* Slide 0: All Admins Combined Overview */
        <div className="flex flex-col gap-6 animate-in fade-in duration-200">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
              <div className="flex items-center justify-between text-xs text-[var(--ink3)]">
                <span className="font-mono uppercase tracking-wider">New Users (10-to-10)</span>
                <UserPlus className="h-4 w-4 text-emerald-400" />
              </div>
              <div className="mt-2 text-2xl font-bold tracking-tight text-emerald-400">
                {period.newUsers.toLocaleString()}
              </div>
              <p className="mt-1 text-[11px] text-[var(--ink3)]">Created in selected cycle</p>
            </div>

            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
              <div className="flex items-center justify-between text-xs text-[var(--ink3)]">
                <span className="font-mono uppercase tracking-wider">Renewals (10-to-10)</span>
                <RefreshCw className="h-4 w-4 text-cyan-400" />
              </div>
              <div className="mt-2 text-2xl font-bold tracking-tight text-cyan-400">
                {period.renewals.toLocaleString()}
              </div>
              <p className="mt-1 text-[11px] text-[var(--ink3)]">Renewed in selected cycle</p>
            </div>

            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
              <div className="flex items-center justify-between text-xs text-[var(--ink3)]">
                <span className="font-mono uppercase tracking-wider">Total Cycle Users</span>
                <Sparkles className="h-4 w-4 text-purple-400" />
              </div>
              <div className="mt-2 text-2xl font-bold tracking-tight text-purple-400">
                {period.total.toLocaleString()}
              </div>
              <p className="mt-1 text-[11px] text-[var(--ink3)]">New + Renewed users</p>
            </div>

            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
              <div className="flex items-center justify-between text-xs text-[var(--ink3)]">
                <span className="font-mono uppercase tracking-wider">Removed Users</span>
                <UserMinus className="h-4 w-4 text-rose-400" />
              </div>
              <div className="mt-2 text-2xl font-bold tracking-tight text-rose-400">
                {allDeleted.length.toLocaleString()}
              </div>
              <p className="mt-1 text-[11px] text-[var(--ink3)]">Deleted in selected cycle</p>
            </div>
          </div>

          {/* Admins Performance Breakdown */}
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
            <h2 className="text-sm font-semibold mb-3">Admin Period Performance Breakdown (10th → 10th)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--bg2)] text-[11px] uppercase tracking-wider text-[var(--ink3)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Admin</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium text-emerald-400">New Users (10-to-10)</th>
                    <th className="px-4 py-3 font-medium text-cyan-400">Renewals (10-to-10)</th>
                    <th className="px-4 py-3 font-medium text-purple-400">Total Cycle</th>
                    <th className="px-4 py-3 font-medium">Active In-Cycle</th>
                    <th className="px-4 py-3 font-medium text-rose-400">Deleted in Cycle</th>
                    <th className="px-4 py-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {admins.map((adm, i) => (
                    <tr key={adm.id} className="hover:bg-[var(--bg2)]/60 transition">
                      <td className="px-4 py-3 font-medium">
                        <div>{adm.displayName || adm.username}</div>
                        <div className="text-xs text-[var(--ink3)] font-mono">{adm.email}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className="rounded bg-[var(--line)] px-2 py-0.5 text-[11px] font-mono">
                          {adm.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-emerald-400">
                        {adm.periodStats.newUsers}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-cyan-400">
                        {adm.periodStats.renewals}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-purple-400">
                        {adm.periodStats.total}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {adm.totalManagedUsers}
                      </td>
                      <td className="px-4 py-3 font-mono text-rose-400">
                        {adm.deletedUsers.length}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setActiveSlide(i + 1)}
                          className="text-xs text-[var(--a1)] hover:underline"
                        >
                          View Admin Slide →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* Slide N: Individual Admin Slide */
        currentAdmin && (
          <div className="flex flex-col gap-6 animate-in fade-in duration-200">
            {/* Admin Header Card */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
              <div className="flex items-center gap-3.5">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--a1)]/15 text-[var(--a1)]">
                  <Shield className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold">{currentAdmin.displayName || currentAdmin.username}</h2>
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-400 border border-emerald-500/25">
                      {currentAdmin.role}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--ink3)] font-mono">{currentAdmin.email}</p>
                </div>
              </div>

              {/* 10th-to-10th Period Counters */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg2)] px-3.5 py-2 text-center">
                  <span className="block text-[10px] uppercase font-mono tracking-wider text-[var(--ink3)]">
                    New Users
                  </span>
                  <span className="text-lg font-bold text-emerald-400">
                    {currentAdmin.periodStats.newUsers}
                  </span>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg2)] px-3.5 py-2 text-center">
                  <span className="block text-[10px] uppercase font-mono tracking-wider text-[var(--ink3)]">
                    Renewals
                  </span>
                  <span className="text-lg font-bold text-cyan-400">
                    {currentAdmin.periodStats.renewals}
                  </span>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg2)] px-3.5 py-2 text-center">
                  <span className="block text-[10px] uppercase font-mono tracking-wider text-[var(--ink3)]">
                    Total Period
                  </span>
                  <span className="text-lg font-bold text-purple-400">
                    {currentAdmin.periodStats.total}
                  </span>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg2)] px-3.5 py-2 text-center">
                  <span className="block text-[10px] uppercase font-mono tracking-wider text-[var(--ink3)]">
                    Deleted in Cycle
                  </span>
                  <span className="text-lg font-bold text-rose-400">
                    {currentAdmin.deletedUsers.length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )
      )}

      {/* Active Users Table Section (Strictly users added or renewed in this cycle) */}
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-[var(--a1)]" />
              {isOverview ? 'Cycle Users (All Admins)' : `Cycle Users for ${currentAdmin?.displayName || currentAdmin?.username}`}
              <span className="text-xs font-normal text-[var(--ink3)]">
                ({filteredActiveUsers.length} user{filteredActiveUsers.length === 1 ? '' : 's'})
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-[var(--ink3)]">
              Showing only users added or renewed in this 10-to-10 cycle ({formatDate(period.periodStart)} – {formatDate(period.periodEnd)}).
            </p>
          </div>

          <div className="relative min-w-[220px]">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-[var(--ink3)]" />
            <input
              type="text"
              placeholder="Search user name or email…"
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              className="w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] pl-9 pr-3 py-1.5 text-xs text-[var(--ink)] outline-none focus:border-[var(--a1)]"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--line)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--bg2)] text-[11px] uppercase tracking-wider text-[var(--ink3)]">
              <tr>
                <th className="px-4 py-3 font-medium">User Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Cycle Status</th>
                <th className="px-4 py-3 font-medium">Credits</th>
                <th className="px-4 py-3 font-medium">Add Date</th>
                <th className="px-4 py-3 font-medium">Expiry Date</th>
                <th className="px-4 py-3 font-medium">Payment Status</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {filteredActiveUsers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-xs text-[var(--ink3)]">
                    No users added or renewed in this cycle ({formatDate(period.periodStart)} – {formatDate(period.periodEnd)}).
                  </td>
                </tr>
              ) : (
                filteredActiveUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-[var(--bg2)]/60 transition">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/admin/users/${u.id}`} className="hover:text-[var(--a1)] transition">
                        {u.username}
                      </Link>
                      {u.displayName && u.displayName !== u.username && (
                        <div className="text-xs text-[var(--ink3)]">{u.displayName}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-[var(--ink2)]">
                      {u.email}
                    </td>
                    <td className="px-4 py-3">
                      {u.cycleType === 'NEW' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          ✨ Added (New)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                          🔄 Renewed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-[var(--a1)]">
                      {(u.credits ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--ink2)]">
                      {formatDateTime(u.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--ink2)]">
                      {formatDateTime(u.planExpiry)}
                    </td>
                    <td className="px-4 py-3">
                      {u.isPaid ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          Paid (${u.paymentAmount || 0})
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                          Due {u.paymentAmount ? `($${u.paymentAmount})` : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="text-xs text-[var(--a1)] hover:underline"
                      >
                        Detail &amp; Pay →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Deleted Users Table Section (Strictly users removed during this cycle) */}
      <section className="rounded-2xl border border-rose-500/25 bg-[var(--card)] p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 text-rose-400">
              <UserMinus className="h-4 w-4" />
              {isOverview ? 'Deleted Users in Cycle' : `Deleted Users for ${currentAdmin?.displayName || currentAdmin?.username}`}
              <span className="text-xs font-normal text-[var(--ink3)]">
                ({filteredDeletedUsers.length} user{filteredDeletedUsers.length === 1 ? '' : 's'})
              </span>
            </h3>
            <p className="mt-0.5 text-xs text-[var(--ink3)]">
              Users added AND removed within this same 10-to-10 cycle ({formatDate(period.periodStart)} – {formatDate(period.periodEnd)}), including days and credits used before removal.
            </p>
          </div>

          <div className="relative min-w-[220px]">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-[var(--ink3)]" />
            <input
              type="text"
              placeholder="Search deleted users…"
              value={deletedQuery}
              onChange={(e) => setDeletedQuery(e.target.value)}
              className="w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] pl-9 pr-3 py-1.5 text-xs text-[var(--ink)] outline-none focus:border-rose-400"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--line)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--bg2)] text-[11px] uppercase tracking-wider text-[var(--ink3)]">
              <tr>
                <th className="px-4 py-3 font-medium">User Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium text-rose-400">When Removed</th>
                <th className="px-4 py-3 font-medium">Days System Used</th>
                <th className="px-4 py-3 font-medium">Credits Used</th>
                <th className="px-4 py-3 font-medium">Last Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {filteredDeletedUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-xs text-[var(--ink3)]">
                    No users added and deleted within this cycle ({formatDate(period.periodStart)} – {formatDate(period.periodEnd)}).
                  </td>
                </tr>
              ) : (
                filteredDeletedUsers.map((d) => (
                  <tr key={d.id + d.deletedAt} className="hover:bg-[var(--bg2)]/60 transition">
                    <td className="px-4 py-3 font-medium text-[var(--ink)]">
                      {d.username}
                      {d.displayName && d.displayName !== d.username && (
                        <div className="text-xs text-[var(--ink3)]">{d.displayName}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-[var(--ink2)]">
                      {d.email}
                    </td>
                    <td className="px-4 py-3 text-xs text-rose-400 font-mono">
                      {formatDateTime(d.deletedAt)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="rounded bg-[var(--line)] px-2 py-0.5 font-mono text-xs font-semibold">
                        {d.daysUsed} day{d.daysUsed === 1 ? '' : 's'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-amber-400 font-semibold">
                      {(d.creditsUsed ?? 0).toLocaleString()} credits
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--ink3)]">
                      {(d.lastCredits ?? 0).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
