'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { flowFetch } from '@/lib/flowApi';
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
  resellerUsername?: string | null;
  activeServerName?: string | null;
  acquiredVia?: string;
  createdAt?: string;
};

type PlanRow = {
  id: string;
  name: string;
  standardCreditsCycle?: number;
  maxParallel?: number;
};

type FilterOpt = { id: string; label: string; name?: string };

const inputClass =
  'w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--a1)]';

const selectClass = `${inputClass} !w-auto min-w-[140px]`;

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<FlowUser[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [hardStd, setHardStd] = useState<Record<string, number>>(HARDCODED_STD_CREDITS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [owner, setOwner] = useState('all');
  const [plan, setPlan] = useState('all');
  const [source, setSource] = useState('all');
  const [filterOpts, setFilterOpts] = useState<{
    statuses: FilterOpt[];
    owners: FilterOpt[];
    plans: FilterOpt[];
    sources: FilterOpt[];
  }>({
    statuses: [],
    owners: [],
    plans: [],
    sources: [],
  });
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [form, setForm] = useState({
    username: '',
    password: '',
    credits: '50',
    planExpiry: '',
    displayName: '',
    notes: '',
    maxParallel: '1',
    planId: '',
    isActive: true,
  });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (status !== 'all') params.set('status', status);
      if (owner !== 'all') params.set('owner', owner);
      if (plan !== 'all') params.set('plan', plan);
      if (source !== 'all') params.set('source', source);
      const qs = params.toString();
      const [usersRes, plansRes] = await Promise.all([
        flowFetch(`/api/admin/users${qs ? `?${qs}` : ''}`),
        flowFetch('/api/admin/plans'),
      ]);
      const usersData = await usersRes.json();
      if (!usersRes.ok || !usersData.success) throw new Error(usersData.error || 'Failed to load users');
      const nextUsers: FlowUser[] = usersData.users || [];
      setUsers(nextUsers);
      setSelected((prev) => {
        const ids = new Set(nextUsers.map((u) => u.id));
        return new Set([...prev].filter((id) => ids.has(id)));
      });
      if (usersData.hardcodedStd) setHardStd(usersData.hardcodedStd);
      if (usersData.filters) setFilterOpts(usersData.filters);

      if (plansRes.ok) {
        const plansData = await plansRes.json();
        if (plansData.success) {
          setPlans(plansData.plans || []);
          if (plansData.hardcodedStd) setHardStd(plansData.hardcodedStd);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, owner, plan, source]);

  useEffect(() => {
    const t = setTimeout(() => {
      load();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const applyPlanDefaults = (planId: string, prev: typeof form) => {
    const p = plans.find((x) => x.id === planId);
    if (!p) return { ...prev, planId };
    const hard = hardStd[p.name] ?? HARDCODED_STD_CREDITS[p.name as keyof typeof HARDCODED_STD_CREDITS];
    return {
      ...prev,
      planId,
      credits: hard != null ? String(hard) : String(p.standardCreditsCycle ?? prev.credits),
      maxParallel: String(p.maxParallel || prev.maxParallel || 1),
    };
  };

  const openCreate = () => {
    const in30 = new Date(Date.now() + 30 * 86400000);
    const free = plans.find((p) => /^free$/i.test(p.name));
    const base = {
      username: '',
      password: '',
      credits: '50',
      planExpiry: in30.toISOString().slice(0, 16),
      displayName: '',
      notes: '',
      maxParallel: '1',
      planId: free?.id || '',
      isActive: true,
    };
    setForm(free ? applyPlanDefaults(free.id, base) : base);
    setShowForm(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        username: form.username.trim(),
        password: form.password,
        credits: Number(form.credits) || 0,
        planExpiry: form.planExpiry ? new Date(form.planExpiry).toISOString() : undefined,
        displayName: form.displayName,
        notes: form.notes,
        maxParallel: Number(form.maxParallel) || 1,
        isActive: form.isActive,
        planId: form.planId || null,
      };
      const res = await flowFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Save failed');
      setShowForm(false);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleBan = async (u: FlowUser) => {
    const banned = !u.banned;
    const res = await flowFetch(`/api/admin/users/${u.id}/ban`, {
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

  const forceLogout = async (u: FlowUser) => {
    if (!confirm(`Force logout "${u.username}" and clear Google cookies on their device?`)) return;
    const res = await flowFetch(`/api/admin/users/${u.id}/force-logout`, { method: 'POST', body: '{}' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.error || 'Force logout failed');
      return;
    }
    setError('');
    alert(data.message || `Revoked ${u.username}`);
  };

  const remove = async (u: FlowUser) => {
    if (!confirm(`Delete user ${u.username}?`)) return;
    const res = await flowFetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.error || 'Delete failed');
      return;
    }
    await load();
  };

  const allVisibleSelected = users.length > 0 && users.every((u) => selected.has(u.id));
  const someSelected = selected.size > 0;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(users.map((u) => u.id)));
  };

  const bulkDelete = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} selected user${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) {
      return;
    }
    setBulkBusy(true);
    setError('');
    try {
      const res = await flowFetch('/api/admin/users/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Bulk delete failed');
      const skipped = Array.isArray(data.skipped) ? data.skipped : [];
      if (skipped.length) {
        const reasons = skipped
          .slice(0, 3)
          .map((s: { username?: string; reason?: string }) => s.username || s.reason || 'skipped')
          .join(', ');
        setError(
          `Deleted ${data.deletedCount || 0}; skipped ${skipped.length}${reasons ? ` (${reasons})` : ''}`
        );
      }
      setSelected(new Set());
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Bulk delete failed');
    } finally {
      setBulkBusy(false);
    }
  };

  const statuses = filterOpts.statuses.length
    ? filterOpts.statuses
    : [
        { id: 'all', label: 'All' },
        { id: 'active', label: 'Active' },
        { id: 'banned', label: 'Banned' },
        { id: 'expired', label: 'Expired' },
      ];
  const owners = filterOpts.owners.length
    ? filterOpts.owners
    : [
        { id: 'all', label: 'All' },
        { id: 'unclaimed', label: 'Unclaimed' },
      ];
  const planOpts = filterOpts.plans.length
    ? filterOpts.plans
    : [{ id: 'all', label: 'All' }, ...plans.map((p) => ({ id: p.id, label: p.name }))];
  const sources = filterOpts.sources.length
    ? filterOpts.sources
    : [
        { id: 'all', label: 'All' },
        { id: 'ADMIN_MANUAL', label: 'Admin added' },
        { id: 'RESELLER', label: 'Reseller added' },
        { id: 'SIGNUP', label: 'Signup' },
      ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          className={`${inputClass} max-w-xs`}
          placeholder="Search users…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex gap-2">
          <button type="button" onClick={load} className="btn-secondary !px-3 !py-2 !text-xs">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button type="button" onClick={openCreate} className="btn-primary !px-3 !py-2 !text-xs">
            <Plus className="h-3.5 w-3.5" />
            Add user
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              Status: {s.label}
            </option>
          ))}
        </select>
        <select className={selectClass} value={owner} onChange={(e) => setOwner(e.target.value)}>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              Owner: {o.label}
            </option>
          ))}
        </select>
        <select className={selectClass} value={plan} onChange={(e) => setPlan(e.target.value)}>
          {planOpts.map((p) => (
            <option key={p.id} value={p.id}>
              Plan: {p.label}
            </option>
          ))}
        </select>
        <select className={selectClass} value={source} onChange={(e) => setSource(e.target.value)}>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              Source: {s.label}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
          {error}
        </p>
      )}

      {someSelected && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3">
          <span className="text-sm text-[var(--ink2)]">{selected.size} selected</span>
          <button
            type="button"
            disabled={bulkBusy}
            onClick={bulkDelete}
            className="inline-flex items-center gap-1.5 rounded-[11px] border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/20 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {bulkBusy ? 'Deleting…' : 'Delete'}
          </button>
          <button
            type="button"
            className="text-xs text-[var(--ink3)] hover:text-[var(--ink)]"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={save}
          className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 sm:grid-cols-2"
        >
          <h3 className="sm:col-span-2 text-[15px] font-semibold">Create end user</h3>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--ink3)]">Username / email</span>
            <input
              required
              className={inputClass}
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--ink3)]">Password</span>
            <input
              type="password"
              required
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
              onChange={(e) => setForm(applyPlanDefaults(e.target.value, form))}
            >
              <option value="">Custom / none</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {hardStd[p.name] != null ? ` (${hardStd[p.name].toLocaleString()} STD)` : ''}
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
            <span className="mb-1 block text-[var(--ink3)]">Display name</span>
            <input
              className={inputClass}
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
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
          <label className="sm:col-span-2 text-sm">
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
          <div className="sm:col-span-2 flex gap-2">
            <button type="submit" disabled={saving} className="btn-primary !px-4 !py-2 !text-xs">
              {saving ? 'Saving…' : 'Create'}
            </button>
            <button
              type="button"
              className="btn-secondary !px-4 !py-2 !text-xs"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-2xl border border-[var(--line)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--bg2)] text-[11px] uppercase tracking-wider text-[var(--ink3)]">
            <tr>
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all users"
                  checked={allVisibleSelected}
                  disabled={loading || users.length === 0}
                  onChange={toggleAllVisible}
                />
              </th>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Owner</th>
              <th className="px-4 py-3 font-medium">Credits</th>
              <th className="px-4 py-3 font-medium">Expiry</th>
              <th className="px-4 py-3 font-medium">Server</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[var(--ink3)]">
                  Loading…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[var(--ink3)]">
                  No users
                </td>
              </tr>
            ) : (
              users.map((u) => {
                const expired = u.planExpiry && new Date(u.planExpiry) <= new Date();
                return (
                  <tr key={u.id} className="border-t border-[var(--line)]">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${u.username}`}
                        checked={selected.has(u.id)}
                        onChange={() => toggleOne(u.id)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="font-medium text-[var(--a1)] hover:underline"
                      >
                        {u.username}
                      </Link>
                      <div className="text-[11px] text-[var(--ink3)]">
                        {u.displayName || u.plan || u.notes || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[13px] text-[var(--ink2)]">
                      {u.ownerLabel || u.resellerUsername || '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-[var(--a1)]">
                      {(u.credits || 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-[13px]">
                      {u.planExpiry ? new Date(u.planExpiry).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-[var(--ink2)]">
                      {u.activeServerName || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {u.banned ? (
                        <span className="text-rose-400">Banned</span>
                      ) : !u.isActive ? (
                        <span className="text-rose-400">Disabled</span>
                      ) : expired ? (
                        <span className="text-amber-400">Expired</span>
                      ) : (
                        <span className="text-emerald-400">Active</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        className="mr-2 text-xs text-[var(--a1)] hover:underline"
                        onClick={() => router.push(`/admin/users/${u.id}`)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="mr-2 text-xs text-amber-400 hover:underline"
                        onClick={() => toggleBan(u)}
                      >
                        {u.banned ? 'Unban' : 'Ban'}
                      </button>
                      <button
                        type="button"
                        className="mr-2 text-xs text-sky-400 hover:underline"
                        onClick={() => forceLogout(u)}
                        title="Revoke session and clear Google cookies"
                      >
                        Force logout
                      </button>
                      <button
                        type="button"
                        className="inline-flex text-[var(--ink3)] hover:text-rose-400"
                        onClick={() => remove(u)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
