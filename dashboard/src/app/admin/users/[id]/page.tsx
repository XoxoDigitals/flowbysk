'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { flowFetch } from '@/lib/flowApi';
import { HARDCODED_STD_CREDITS } from '@/lib/plans';
import { formatLogDetails } from '@/lib/adminLogFormat';
import { AdminTablePager } from '@/components/AdminTablePager';

const ACTIVITY_PAGE_SIZE = 10;
const LOGIN_NOISE = new Set([
  'client_login',
  'extension_login_start',
  'extension_step',
  'extension_login_finish',
]);

type GoogleAccountLockRow = {
  serverId: string;
  serverName: string;
  serverEmail?: string;
  imageOnly?: boolean;
  isCurrent?: boolean;
  locked: boolean;
  lockedUntil?: string | null;
  retryAfterSeconds: number;
  lastLoginAt?: string | null;
  lastOutcome?: string | null;
  loginCount?: number;
  successfulLogins?: number;
};

type FlowUser = {
  id: string;
  username: string;
  displayName?: string;
  credits: number;
  planExpiry: string;
  isActive: boolean;
  banned?: boolean;
  maxParallel?: number;
  notes?: string;
  planId?: string | null;
  plan?: string;
  ownerLabel?: string | null;
  acquiredVia?: string;
  createdAt?: string;
  lastIp?: string | null;
  lastCountry?: string | null;
  lastDeviceId?: string | null;
  lastClient?: string | null;
  deviceIds?: string[];
  activeServerId?: string | null;
  activeServerName?: string | null;
  activeServerEmail?: string | null;
  googleSessionLocked?: boolean;
  googleSessionLockUntil?: string | null;
  googleSessionRetryAfterSeconds?: number;
  googleServerLocks?: Record<string, string>;
  googleAccountLocks?: GoogleAccountLockRow[];
  serverTime?: string;
};

type PlanRow = { id: string; name: string; maxParallel?: number; standardCreditsCycle?: number };

type CreditRow = {
  id: string;
  amount: number;
  balanceAfter: number;
  type: string;
  reason?: string | null;
  createdAt: string;
};

type ActivityRow = {
  id: string;
  action: string;
  username?: string | null;
  createdAt: string;
  details?: Record<string, unknown> | null;
};

type LoginEvent = {
  at?: string;
  action?: string;
  label?: string;
  stage?: string;
  outcome?: string;
};

type LoginSession = {
  attemptId: string;
  startedAt?: string;
  finishedAt?: string | null;
  outcome?: string;
  ip?: string | null;
  country?: string | null;
  serverId?: string | null;
  serverName?: string | null;
  serverEmail?: string | null;
  deviceId?: string | null;
  client?: string | null;
  lockedUntil?: string | null;
  cancelledReason?: string | null;
  durationMs?: number | null;
  totalSteps?: number;
  startRetries?: number;
  stepCounts?: { email?: number; password?: number; otp?: number; other?: number };
  events?: LoginEvent[];
};

const inputClass =
  'w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--a1)]';

function formatWhen(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatDuration(ms?: number | null) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function outcomeBadge(outcome?: string) {
  const o = String(outcome || 'unknown').toLowerCase();
  if (o === 'success') return 'bg-emerald-500/15 text-emerald-400';
  if (o === 'in_progress' || o === 'api_login_only') return 'bg-amber-500/15 text-amber-400';
  if (o === 'cancelled' || o === 'failed') return 'bg-rose-500/15 text-rose-400';
  return 'bg-[var(--bg2)] text-[var(--ink3)]';
}

function formatCountdown(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function Card({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
      <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">{label}</span>
      <span className="text-lg font-semibold tracking-tight">{value}</span>
      {hint ? <span className="text-xs text-[var(--ink3)]">{hint}</span> : null}
    </div>
  );
}

export default function AdminUserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id || '');
  const [user, setUser] = useState<FlowUser | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [hardStd, setHardStd] = useState<Record<string, number>>(HARDCODED_STD_CREDITS);
  const [creditHistory, setCreditHistory] = useState<CreditRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loginSessions, setLoginSessions] = useState<LoginSession[]>([]);
  const [activityPage, setActivityPage] = useState(1);
  const [expandedAttempt, setExpandedAttempt] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Google lock: server gives seconds left; we count down locally on a monotonic clock.
  const [lockEndsAt, setLockEndsAt] = useState(0);
  const [serverLockEndsAt, setServerLockEndsAt] = useState<Record<string, number>>({});
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState('');
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [form, setForm] = useState({
    password: '',
    credits: '0',
    planExpiry: '',
    displayName: '',
    notes: '',
    maxParallel: '1',
    planId: '',
    isActive: true,
  });

  const syncLockMonotonic = (u: FlowUser) => {
    const nowMono = performance.now();
    const secs = Number(u.googleSessionRetryAfterSeconds) || 0;
    setLockEndsAt(secs > 0 ? nowMono + secs * 1000 : 0);
    const nextMap: Record<string, number> = {};
    for (const row of u.googleAccountLocks || []) {
      const s = Number(row.retryAfterSeconds) || 0;
      if (row.serverId && s > 0) {
        nextMap[row.serverId] = nowMono + s * 1000;
      }
    }
    setServerLockEndsAt(nextMap);
  };

  const load = async () => {
    setError('');
    const [userRes, plansRes] = await Promise.all([
      flowFetch(`/api/admin/users/${id}`),
      flowFetch('/api/admin/plans'),
    ]);
    const data = await userRes.json();
    if (!userRes.ok || !data.success) throw new Error(data.error || 'Failed to load user');
    const u = data.user as FlowUser;
    setUser(u);
    syncLockMonotonic(u);
    setCreditHistory(data.creditHistory || []);
    setActivity(data.activity || []);
    setLoginSessions(data.loginSessions || []);
    setActivityPage(1);
    setExpandedAttempt(null);
    if (data.hardcodedStd) setHardStd(data.hardcodedStd);
    setForm({
      password: '',
      credits: String(u.credits ?? 0),
      planExpiry: u.planExpiry ? new Date(u.planExpiry).toISOString().slice(0, 16) : '',
      displayName: u.displayName || '',
      notes: u.notes || '',
      maxParallel: String(u.maxParallel || 1),
      planId: u.planId || '',
      isActive: u.isActive !== false && !u.banned,
    });
    if (plansRes.ok) {
      const pd = await plansRes.json();
      if (pd.success) {
        setPlans(pd.plans || []);
        if (pd.hardcodedStd) setHardStd(pd.hardcodedStd);
      }
    }
  };

  /** Silent refresh: updates cards, lock and activity but never touches the edit form. */
  const refresh = async () => {
    if (!id) return;
    try {
      const res = await flowFetch(`/api/admin/users/${id}`);
      const data = await res.json();
      if (!res.ok || !data.success) return;
      const u = data.user as FlowUser;
      setUser(u);
      setCreditHistory(data.creditHistory || []);
      setActivity(data.activity || []);
      setLoginSessions(data.loginSessions || []);
      syncLockMonotonic(u);
      setLastSync(new Date());
    } catch {
      /* keep last good data */
    }
  };

  useEffect(() => {
    if (!id) return;
    load()
      .then(() => refresh())
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Always fresh: poll every 5s while the tab is visible, and on focus.
  useEffect(() => {
    if (!id) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = setInterval(tick, 5000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 1s ticker only while a lock is running; refresh once when it ends.
  useEffect(() => {
    const hasAnyMono =
      lockEndsAt > 0 || Object.values(serverLockEndsAt).some((end) => end > 0);
    if (!hasAnyMono) return;
    const timer = setInterval(() => {
      setTick((n) => n + 1);
      if (lockEndsAt > 0 && performance.now() >= lockEndsAt) {
        setLockEndsAt(0);
        void refresh();
      }
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockEndsAt, serverLockEndsAt]);

  const resetGoogleLock = async (serverId?: string, serverName?: string) => {
    if (!user) return;
    const label = serverName || serverId;
    const msg = serverId
      ? `Reset the 1-hour Google login lock on "${label}" for ${user.username}?`
      : `Reset ALL Google login locks for ${user.username}?`;
    if (!confirm(msg)) return;
    const busyKey = serverId ? `lock:${serverId}` : 'lock';
    setBusy(busyKey);
    setError('');
    try {
      const res = await flowFetch(`/api/admin/users/${user.id}/reset-google-lock`, {
        method: 'POST',
        body: JSON.stringify(serverId ? { serverId } : {}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Reset failed');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setBusy('');
    }
  };

  const resetLoginStats = async () => {
    if (!user) return;
    if (!confirm(`Reset login statistics for ${user.username}? The timeline restarts from now (logs are kept).`)) return;
    setBusy('stats');
    setError('');
    try {
      const res = await flowFetch(`/api/admin/users/${user.id}/reset-login-stats`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Reset failed');
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setBusy('');
    }
  };

  const applyPlanDefaults = (planId: string) => {
    const p = plans.find((x) => x.id === planId);
    if (!p) {
      setForm((f) => ({ ...f, planId }));
      return;
    }
    const hard = hardStd[p.name] ?? HARDCODED_STD_CREDITS[p.name as keyof typeof HARDCODED_STD_CREDITS];
    setForm((f) => ({
      ...f,
      planId,
      credits: hard != null ? String(hard) : String(p.standardCreditsCycle ?? f.credits),
      maxParallel: String(p.maxParallel || f.maxParallel || 1),
    }));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        credits: Number(form.credits) || 0,
        planExpiry: form.planExpiry ? new Date(form.planExpiry).toISOString() : undefined,
        displayName: form.displayName,
        notes: form.notes,
        maxParallel: Number(form.maxParallel) || 1,
        isActive: form.isActive,
        planId: form.planId || null,
      };
      if (form.password.trim()) payload.password = form.password;
      const res = await flowFetch(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Save failed');
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleBan = async () => {
    if (!user) return;
    const banned = !user.banned;
    const res = await flowFetch(`/api/admin/users/${user.id}/ban`, {
      method: 'PUT',
      body: JSON.stringify({ banned }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.error || 'Ban update failed');
      return;
    }
    await load();
  };

  const remove = async () => {
    if (!user) return;
    if (!confirm(`Delete user ${user.username}?`)) return;
    const res = await flowFetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.error || 'Delete failed');
      return;
    }
    router.push('/admin/users');
  };

  const otherActivity = useMemo(
    () => activity.filter((a) => !LOGIN_NOISE.has(String(a.action || ''))),
    [activity]
  );
  const otherPageRows = otherActivity.slice(
    (activityPage - 1) * ACTIVITY_PAGE_SIZE,
    activityPage * ACTIVITY_PAGE_SIZE
  );

  if (!user && !error) {
    return <p className="text-sm text-[var(--ink3)]">Loading…</p>;
  }

  const nowMono = typeof performance !== 'undefined' ? performance.now() : 0;
  const accountLocks = user?.googleAccountLocks || [];
  const serverRemainingSec = (serverId: string, fallbackSec = 0) => {
    const endMono = serverLockEndsAt[serverId];
    if (endMono && endMono > 0) {
      return Math.max(0, Math.ceil((endMono - nowMono) / 1000));
    }
    return Math.max(0, Math.floor(fallbackSec));
  };
  const lockedAccounts = accountLocks.filter(
    (a) => serverRemainingSec(a.serverId, a.retryAfterSeconds) > 0
  );
  const lockRemaining =
    lockEndsAt > 0 ? Math.max(0, Math.ceil((lockEndsAt - nowMono) / 1000)) : 0;
  const expired = user?.planExpiry && new Date(user.planExpiry) <= new Date();
  const statusLabel = user?.banned
    ? 'Banned'
    : !user?.isActive
      ? 'Disabled'
      : expired
        ? 'Expired'
        : 'Active';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/users" className="btn-secondary !px-3 !py-2 !text-xs">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{user?.username || 'User'}</h2>
            <p className="text-xs text-[var(--ink3)]">{user?.displayName || 'End user detail'}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary !px-3 !py-2 !text-xs" onClick={toggleBan}>
            {user?.banned ? 'Unban' : 'Ban'}
          </button>
          <button
            type="button"
            className="btn-secondary !px-3 !py-2 !text-xs text-rose-400"
            onClick={remove}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
          {error}
        </p>
      )}

      {user && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Card label="PLAN" value={user.plan || '—'} />
            <Card label="CREDITS" value={(user.credits || 0).toLocaleString()} />
            <Card
              label="EXPIRY"
              value={user.planExpiry ? new Date(user.planExpiry).toLocaleDateString() : '—'}
            />
            <Card label="STATUS" value={statusLabel} />
            <Card label="OWNER" value={user.ownerLabel || '—'} hint={user.acquiredVia || undefined} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Card label="LAST IP" value={user.lastIp || '—'} />
            <Card label="COUNTRY" value={user.lastCountry || '—'} />
            <Card
              label="DEVICE ID"
              value={user.lastDeviceId || '—'}
              hint={
                Array.isArray(user.deviceIds) && user.deviceIds.length > 1
                  ? `${user.deviceIds.length} devices seen`
                  : undefined
              }
            />
            <Card
              label="CLIENT"
              value={user.lastClient || '—'}
              hint={user.activeServerName ? `Active: ${user.activeServerName}` : undefined}
            />
            <div
              className={`flex flex-col gap-1 rounded-2xl border p-4 ${
                lockRemaining > 0
                  ? 'border-amber-500/40 bg-amber-500/10'
                  : 'border-[var(--line)] bg-[var(--card)]'
              }`}
            >
              <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                GOOGLE LOCK
              </span>
              <span
                className={`text-lg font-semibold tracking-tight tabular-nums ${
                  lockRemaining > 0 ? 'text-amber-400' : 'text-emerald-400'
                }`}
              >
                {lockRemaining > 0
                  ? `${formatCountdown(lockRemaining)}${
                      lockedAccounts.length > 1 ? ` (${lockedAccounts.length} locked)` : ''
                    }`
                  : 'Unlocked'}
              </span>
              <span className="text-xs text-[var(--ink3)]">
                {lockedAccounts.length > 0
                  ? `${lockedAccounts.map((a) => a.serverName).join(', ')} · Ends ${formatWhen(
                      user.googleSessionLockUntil
                    )}`
                  : lockRemaining > 0
                    ? `Ends ${formatWhen(user.googleSessionLockUntil)}`
                    : 'No login lock active'}
              </span>
              <button
                type="button"
                disabled={busy === 'lock' || lockRemaining <= 0}
                onClick={() => resetGoogleLock()}
                className="btn-secondary mt-2 !px-3 !py-1.5 !text-xs disabled:opacity-40"
              >
                {busy === 'lock' ? 'Resetting…' : 'Reset all locks'}
              </button>
            </div>
          </div>

          <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">
                  Logged-in Google Accounts &amp; Per-Account Locks
                </h3>
                <p className="mt-0.5 text-[12px] text-[var(--ink3)]">
                  Each server account has its own independent 1-hour lock after Google login. You can reset any single account or all accounts.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-[var(--ink3)]">
                  {accountLocks.length} account{accountLocks.length === 1 ? '' : 's'} used ·{' '}
                  {lockedAccounts.length} locked
                </span>
                {lockRemaining > 0 && (
                  <button
                    type="button"
                    disabled={busy === 'lock'}
                    onClick={() => resetGoogleLock()}
                    className="btn-secondary !px-3 !py-1.5 !text-xs"
                  >
                    {busy === 'lock' ? 'Resetting…' : 'Reset all locks'}
                  </button>
                )}
              </div>
            </div>

            {accountLocks.length === 0 ? (
              <p className="rounded-xl border border-[var(--line)] px-4 py-5 text-center text-sm text-[var(--ink3)]">
                User has not logged into any Google server account yet.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {accountLocks.map((acc) => {
                  const remSec = serverRemainingSec(acc.serverId, acc.retryAfterSeconds);
                  const isLocked = remSec > 0;
                  const rowBusy = busy === `lock:${acc.serverId}` || busy === 'lock';
                  return (
                    <div
                      key={acc.serverId}
                      className={`flex flex-col justify-between gap-3 rounded-xl border p-4 ${
                        isLocked
                          ? 'border-amber-500/40 bg-amber-500/10'
                          : 'border-[var(--line)] bg-[var(--bg2)]'
                      }`}
                    >
                      <div className="flex flex-col gap-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-[var(--ink)]">
                            {acc.serverName}
                          </span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {acc.isCurrent && (
                              <span className="rounded-full bg-sky-500/15 px-2 py-0.5 font-mono text-[10px] font-medium uppercase text-sky-400">
                                Current
                              </span>
                            )}
                            {acc.imageOnly && (
                              <span className="rounded-full bg-purple-500/15 px-2 py-0.5 font-mono text-[10px] font-medium uppercase text-purple-300">
                                Image Only
                              </span>
                            )}
                            <span
                              className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tabular-nums ${
                                isLocked
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : 'bg-emerald-500/15 text-emerald-400'
                              }`}
                            >
                              {isLocked ? `LOCKED · ${formatCountdown(remSec)}` : 'Unlocked'}
                            </span>
                          </div>
                        </div>

                        {acc.serverEmail ? (
                          <div className="font-mono text-xs text-sky-400">{acc.serverEmail}</div>
                        ) : null}

                        <div className="mt-1 space-y-0.5 text-[11px] text-[var(--ink3)]">
                          <div>
                            Last login: <span className="text-[var(--ink2)]">{formatWhen(acc.lastLoginAt)}</span>
                          </div>
                          <div>
                            Sessions: <span className="text-[var(--ink2)]">{acc.loginCount || 0}</span>
                            {acc.lastOutcome ? (
                              <>
                                {' · '}Last status:{' '}
                                <span className="text-[var(--ink2)]">
                                  {String(acc.lastOutcome).replace(/_/g, ' ')}
                                </span>
                              </>
                            ) : null}
                          </div>
                          {isLocked && acc.lockedUntil ? (
                            <div className="text-amber-300/90">
                              Lock ends: {formatWhen(acc.lockedUntil)}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center justify-end border-t border-[var(--line)] pt-2.5">
                        <button
                          type="button"
                          disabled={rowBusy || !isLocked}
                          onClick={() => resetGoogleLock(acc.serverId, acc.serverName)}
                          className="btn-secondary !px-3 !py-1.5 !text-xs disabled:opacity-40"
                        >
                          {busy === `lock:${acc.serverId}`
                            ? 'Resetting…'
                            : isLocked
                              ? `Reset ${acc.serverName} lock`
                              : 'Unlocked'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
              <h3 className="mb-3 text-sm font-semibold">Credit history</h3>
              <div className="max-h-80 overflow-auto">
                {creditHistory.length === 0 ? (
                  <p className="text-sm text-[var(--ink3)]">No credit ledger entries yet.</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="text-[11px] uppercase tracking-wider text-[var(--ink3)]">
                      <tr>
                        <th className="pb-2">When</th>
                        <th className="pb-2">Type</th>
                        <th className="pb-2">Δ</th>
                        <th className="pb-2">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {creditHistory.map((row) => (
                        <tr key={row.id} className="border-t border-[var(--line)]">
                          <td className="py-2 text-xs text-[var(--ink3)]">
                            {new Date(row.createdAt).toLocaleString()}
                          </td>
                          <td className="py-2 text-xs">
                            {row.type}
                            {row.reason ? (
                              <span className="mt-0.5 block text-[10px] text-[var(--ink3)]">
                                {row.reason}
                              </span>
                            ) : null}
                          </td>
                          <td
                            className={`py-2 font-mono text-xs ${
                              row.amount >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {row.amount >= 0 ? '+' : ''}
                            {row.amount}
                          </td>
                          <td className="py-2 font-mono text-xs">{row.balanceAfter}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
              <h3 className="mb-3 text-sm font-semibold">Settings</h3>
              <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block text-[var(--ink3)]">New password (optional)</span>
                  <input
                    type="password"
                    className={inputClass}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[var(--ink3)]">Plan</span>
                  <select
                    className={inputClass}
                    value={form.planId}
                    onChange={(e) => applyPlanDefaults(e.target.value)}
                  >
                    <option value="">Custom / none</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {hardStd[p.name] != null
                          ? ` (${hardStd[p.name].toLocaleString()} STD)`
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[var(--ink3)]">Credits</span>
                  <input
                    className={inputClass}
                    value={form.credits}
                    onChange={(e) => setForm({ ...form, credits: e.target.value })}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[var(--ink3)]">Plan expiry</span>
                  <input
                    type="datetime-local"
                    className={inputClass}
                    value={form.planExpiry}
                    onChange={(e) => setForm({ ...form, planExpiry: e.target.value })}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[var(--ink3)]">Max parallel</span>
                  <input
                    className={inputClass}
                    value={form.maxParallel}
                    onChange={(e) => setForm({ ...form, maxParallel: e.target.value })}
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block text-[var(--ink3)]">Display name</span>
                  <input
                    className={inputClass}
                    value={form.displayName}
                    onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block text-[var(--ink3)]">Notes</span>
                  <input
                    className={inputClass}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  />
                  Active
                </label>
                <div className="sm:col-span-2">
                  <button type="submit" disabled={saving} className="btn-primary !px-4 !py-2 !text-xs">
                    {saving ? 'Saving…' : 'Save settings'}
                  </button>
                </div>
              </form>
            </section>
          </div>

          <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">Activity</h3>
                <p className="mt-0.5 text-[12px] text-[var(--ink3)]">
                  One row per Google login (start → steps → finish). Bans and credit actions below.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-[11px] text-[var(--ink3)]">
                  {loginSessions.length} login
                  {loginSessions.length === 1 ? '' : 's'}
                  {otherActivity.length
                    ? ` · ${otherActivity.length} other`
                    : ''}
                  {lastSync ? ` · live ${lastSync.toLocaleTimeString()}` : ''}
                </span>
                <button
                  type="button"
                  disabled={busy === 'stats'}
                  onClick={resetLoginStats}
                  className="btn-secondary !px-3 !py-1.5 !text-xs"
                >
                  {busy === 'stats' ? 'Resetting…' : 'Reset login stats'}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {loginSessions.length === 0 ? (
                <p className="rounded-xl border border-[var(--line)] px-4 py-6 text-center text-sm text-[var(--ink3)]">
                  No Google login sessions yet
                </p>
              ) : (
                loginSessions.map((s) => {
                  const open = expandedAttempt === s.attemptId;
                  const meta = [s.ip, s.country, s.serverName, s.client, s.deviceId ? `device ${s.deviceId}` : null]
                    .filter(Boolean)
                    .join(' · ');
                  const sessionSrvLocked =
                    s.serverId && serverRemainingSec(s.serverId, 0) > 0;
                  return (
                    <div
                      key={s.attemptId}
                      className="overflow-hidden rounded-xl border border-[var(--line)]"
                    >
                      <button
                        type="button"
                        className="flex w-full flex-wrap items-start justify-between gap-3 bg-[var(--bg2)] px-4 py-3 text-left"
                        onClick={() =>
                          setExpandedAttempt(open ? null : s.attemptId)
                        }
                      >
                        <div>
                          <div className="text-[12px] text-[var(--ink3)]">
                            {formatWhen(s.startedAt)}
                            {s.finishedAt ? ` → ${formatWhen(s.finishedAt)}` : ''}
                            {' · '}
                            {formatDuration(s.durationMs)}
                            {(s.startRetries || 0) > 0
                              ? ` · ${s.startRetries} start retries collapsed`
                              : ''}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--ink)]">
                            <span>Google login</span>
                            {s.serverName ? (
                              <span className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 font-mono text-xs font-medium text-sky-300">
                                {s.serverName}
                                {s.serverEmail ? ` (${s.serverEmail})` : ''}
                              </span>
                            ) : null}
                            <span className="text-[var(--ink3)]">
                              · email {s.stepCounts?.email || 0} · password{' '}
                              {s.stepCounts?.password || 0} · otp {s.stepCounts?.otp || 0}
                            </span>
                          </div>
                          <div className="mt-1 font-mono text-[11px] text-[var(--ink3)]">
                            {meta || '—'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {sessionSrvLocked && s.serverId ? (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                void resetGoogleLock(s.serverId || undefined, s.serverName || undefined);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.stopPropagation();
                                  void resetGoogleLock(s.serverId || undefined, s.serverName || undefined);
                                }
                              }}
                              className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-300 hover:bg-amber-500/25"
                            >
                              Reset lock
                            </span>
                          ) : null}
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide ${outcomeBadge(
                              s.outcome
                            )}`}
                          >
                            {String(s.outcome || 'unknown').toLowerCase() === 'success'
                              ? 'session complete'
                              : String(s.outcome || 'unknown').replace(/_/g, ' ')}
                          </span>
                        </div>
                      </button>
                      {open ? (
                        <ol className="space-y-2 border-t border-[var(--line)] px-4 py-3 pl-8">
                          {(s.events || []).map((ev, i) => (
                            <li key={`${s.attemptId}-${i}`} className="relative text-sm">
                              <span className="absolute -left-4 top-1.5 h-2 w-2 rounded-full bg-[var(--a1)]" />
                              <div className="text-[11px] text-[var(--ink3)]">
                                {formatWhen(ev.at)}
                              </div>
                              <div>{ev.label || ev.action}</div>
                            </li>
                          ))}
                          {s.lockedUntil ? (
                            <li className="text-[12px] text-[var(--ink3)]">
                              Lock until {formatWhen(s.lockedUntil)}
                            </li>
                          ) : null}
                        </ol>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>

            {otherActivity.length > 0 ? (
              <>
                <h4 className="mb-2 mt-5 text-[12px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
                  Other (bans, credits, devices)
                </h4>
                <div className="overflow-hidden rounded-xl border border-[var(--line)]">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[var(--bg2)] text-[11px] uppercase tracking-wider text-[var(--ink3)]">
                      <tr>
                        <th className="px-4 py-3 font-medium">When</th>
                        <th className="px-4 py-3 font-medium">Action</th>
                        <th className="px-4 py-3 font-medium">IP / Country / Device / Client</th>
                      </tr>
                    </thead>
                    <tbody>
                      {otherPageRows.map((a) => (
                        <tr key={a.id} className="border-t border-[var(--line)] align-top">
                          <td className="whitespace-nowrap px-4 py-3 text-[12px] text-[var(--ink3)]">
                            {formatWhen(a.createdAt)}
                          </td>
                          <td className="px-4 py-3 font-mono text-[12px]">{a.action}</td>
                          <td className="break-all px-4 py-3 font-mono text-[11px] text-[var(--ink2)]">
                            {formatLogDetails(a.details || null) || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <AdminTablePager
                  page={activityPage}
                  pageSize={ACTIVITY_PAGE_SIZE}
                  total={otherActivity.length}
                  onPageChange={setActivityPage}
                />
              </>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
