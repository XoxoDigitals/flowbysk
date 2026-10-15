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
  serverName?: string | null;
  deviceId?: string | null;
  lockedUntil?: string | null;
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

  useEffect(() => {
    if (!id) return;
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            <Card label="CLIENT" value={user.lastClient || '—'} />
          </div>

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
              <span className="font-mono text-[11px] text-[var(--ink3)]">
                {loginSessions.length} login
                {loginSessions.length === 1 ? '' : 's'}
                {otherActivity.length
                  ? ` · ${otherActivity.length} other`
                  : ''}
              </span>
            </div>

            <div className="flex flex-col gap-3">
              {loginSessions.length === 0 ? (
                <p className="rounded-xl border border-[var(--line)] px-4 py-6 text-center text-sm text-[var(--ink3)]">
                  No Google login sessions yet
                </p>
              ) : (
                loginSessions.map((s) => {
                  const open = expandedAttempt === s.attemptId;
                  const meta = [s.ip, s.country, s.serverName, s.deviceId ? `device ${s.deviceId}` : null]
                    .filter(Boolean)
                    .join(' · ');
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
                          <div className="mt-1 text-sm text-[var(--ink)]">
                            Google login
                            <span className="text-[var(--ink3)]">
                              {' '}
                              · email {s.stepCounts?.email || 0} · password{' '}
                              {s.stepCounts?.password || 0} · otp {s.stepCounts?.otp || 0}
                            </span>
                          </div>
                          <div className="mt-1 font-mono text-[11px] text-[var(--ink3)]">
                            {meta || '—'}
                          </div>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide ${outcomeBadge(
                            s.outcome
                          )}`}
                        >
                          {String(s.outcome || 'unknown').toLowerCase() === 'success'
                            ? 'session complete'
                            : s.outcome || 'unknown'}
                        </span>
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
