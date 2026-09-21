'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { clearSession, flowFetch, readSession } from '@/lib/flowApi';
import { HARDCODED_STD_CREDITS } from '@/lib/plans';

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
};

type PlanOpt = {
  id: string;
  name: string;
  seatsRemaining?: number;
  seatsAllocated?: number;
  seatsUsed?: number;
  maxParallel?: number;
};

type CreditRow = {
  id: string;
  amount: number;
  balanceAfter: number;
  type: string;
  reason?: string | null;
  createdAt: string;
};

const inputClass =
  'w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--a1)]';

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
      <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">{label}</span>
      <span className="text-lg font-semibold tracking-tight">{value}</span>
    </div>
  );
}

export default function ResellerUserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id || '');
  const [user, setUser] = useState<FlowUser | null>(null);
  const [plans, setPlans] = useState<PlanOpt[]>([]);
  const [hardStd, setHardStd] = useState<Record<string, number>>(HARDCODED_STD_CREDITS);
  const [creditHistory, setCreditHistory] = useState<CreditRow[]>([]);
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
    const session = readSession();
    if (!session?.token || session.role !== 'reseller') {
      router.replace('/auth/login');
      return;
    }
    setError('');
    const [userRes, plansRes] = await Promise.all([
      flowFetch(`/api/reseller/users/${id}`),
      flowFetch('/api/reseller/plans'),
    ]);
    if (userRes.status === 401) {
      clearSession();
      router.replace('/auth/login');
      return;
    }
    const data = await userRes.json();
    if (!userRes.ok || !data.success) throw new Error(data.error || 'Failed to load user');
    const u = data.user as FlowUser;
    setUser(u);
    setCreditHistory(data.creditHistory || []);
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
      credits: hard != null ? String(hard) : f.credits,
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
      const res = await flowFetch(`/api/reseller/users/${user.id}`, {
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
    const res = await flowFetch(`/api/reseller/users/${user.id}/ban`, {
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
    const res = await flowFetch(`/api/reseller/users/${user.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.error || 'Delete failed');
      return;
    }
    router.push('/reseller');
  };

  if (!user && !error) {
    return <p className="p-6 text-sm text-[var(--ink3)]">Loading…</p>;
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
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-5 bg-[var(--bg)] p-6 text-[var(--ink)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/reseller" className="btn-secondary !px-3 !py-2 !text-xs">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{user?.username || 'User'}</h1>
            <p className="text-xs text-[var(--ink3)]">{user?.displayName || 'User detail'}</p>
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card label="PLAN" value={user.plan || '—'} />
            <Card label="CREDITS" value={(user.credits || 0).toLocaleString()} />
            <Card
              label="EXPIRY"
              value={user.planExpiry ? new Date(user.planExpiry).toLocaleDateString() : '—'}
            />
            <Card label="STATUS" value={statusLabel} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
              <h3 className="mb-3 text-sm font-semibold">Credit history</h3>
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
                        <td className="py-2 text-xs">{row.type}</td>
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
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.seatsUsed ?? 0}/{p.seatsAllocated ?? 0})
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
        </>
      )}
    </div>
  );
}
