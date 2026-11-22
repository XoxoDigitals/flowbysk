'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, Plus, Trash2, User } from 'lucide-react';
import { clearSession, flowFetch, readSession } from '@/lib/flowApi';
import { HARDCODED_STD_CREDITS } from '@/lib/plans';

type Row = {
  id: string;
  username: string;
  displayName: string;
  credits: number;
  planExpiry: string;
  isActive: boolean;
  banned?: boolean;
  maxParallel: number;
  plan: string;
  planId?: string | null;
  createdAt?: string;
};

type SeatGrant = {
  planId: string;
  planName?: string;
  seatsAllocated: number;
  seatsUsed?: number;
};

type PlanOpt = {
  id: string;
  name: string;
  seatsRemaining?: number;
  seatsAllocated?: number;
  seatsUsed?: number;
  maxParallel?: number;
};

const inputClass =
  'w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--a1)]';

const selectClass = `${inputClass} !w-auto min-w-[140px]`;

function defaultExpiry() {
  return new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
}

export default function ResellerDashboardPage() {
  const router = useRouter();
  const [users, setUsers] = useState<Row[]>([]);
  const [seatGrants, setSeatGrants] = useState<SeatGrant[]>([]);
  const [plans, setPlans] = useState<PlanOpt[]>([]);
  const [hardStd, setHardStd] = useState<Record<string, number>>(HARDCODED_STD_CREDITS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [planFilter, setPlanFilter] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [me, setMe] = useState<{ username: string; displayName: string } | null>(null);
  const [profileForm, setProfileForm] = useState({
    displayName: '',
    currentPassword: '',
    newPassword: '',
  });
  const [form, setForm] = useState({
    username: '',
    password: '',
    displayName: '',
    credits: '50',
    planExpiry: defaultExpiry(),
    maxParallel: '1',
    planId: '',
  });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const session = readSession();
      if (!session?.token || session.role !== 'reseller') {
        router.replace('/auth/login');
        return;
      }

      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (status !== 'all') params.set('status', status);
      if (planFilter !== 'all') params.set('plan', planFilter);
      const qs = params.toString();

      const [usersRes, meRes, plansRes] = await Promise.all([
        flowFetch(`/api/reseller/users${qs ? `?${qs}` : ''}`),
        flowFetch('/api/reseller/me'),
        flowFetch('/api/reseller/plans'),
      ]);

      if (usersRes.status === 401 || meRes.status === 401) {
        clearSession();
        router.replace('/auth/login');
        return;
      }

      const usersData = await usersRes.json();
      if (!usersRes.ok || !usersData.success) {
        throw new Error(usersData.error || 'Failed to load users');
      }
      const nextUsers: Row[] = usersData.users || [];
      setUsers(nextUsers);
      setSelected((prev) => {
        const ids = new Set(nextUsers.map((u) => u.id));
        return new Set([...prev].filter((id) => ids.has(id)));
      });
      if (usersData.seatGrants) setSeatGrants(usersData.seatGrants);

      if (meRes.ok) {
        const meData = await meRes.json();
        if (meData.success && meData.reseller) {
          setMe({
            username: meData.reseller.username,
            displayName: meData.reseller.displayName || '',
          });
          setProfileForm((f) => ({
            ...f,
            displayName: meData.reseller.displayName || '',
          }));
          if (meData.reseller.seatGrants) setSeatGrants(meData.reseller.seatGrants);
        }
      }

      if (plansRes.ok) {
        const pd = await plansRes.json();
        if (pd.success) {
          setPlans(pd.plans || []);
          if (pd.hardcodedStd) setHardStd(pd.hardcodedStd);
          if (pd.seatGrants) setSeatGrants(pd.seatGrants);
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, planFilter]);

  useEffect(() => {
    const t = setTimeout(() => load(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const openCreate = () => {
    const first = plans.find((p) => (p.seatsRemaining ?? 0) > 0) || plans[0];
    const hard =
      first && (hardStd[first.name] ?? HARDCODED_STD_CREDITS[first.name as keyof typeof HARDCODED_STD_CREDITS]);
    setForm({
      username: '',
      password: '',
      displayName: '',
      credits: hard != null ? String(hard) : '50',
      planExpiry: defaultExpiry(),
      maxParallel: String(first?.maxParallel || 1),
      planId: first?.id || '',
    });
    setShowCreate(true);
  };

  const onPlanChange = (planId: string) => {
    const p = plans.find((x) => x.id === planId);
    const hard =
      p && (hardStd[p.name] ?? HARDCODED_STD_CREDITS[p.name as keyof typeof HARDCODED_STD_CREDITS]);
    setForm((f) => ({
      ...f,
      planId,
      credits: hard != null ? String(hard) : f.credits,
      maxParallel: String(p?.maxParallel || f.maxParallel || 1),
    }));
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await flowFetch('/api/reseller/users', {
        method: 'POST',
        body: JSON.stringify({
          username: form.username.trim(),
          password: form.password,
          displayName: form.displayName.trim(),
          credits: Number(form.credits) || 0,
          planExpiry: form.planExpiry ? new Date(form.planExpiry).toISOString() : undefined,
          maxParallel: Number(form.maxParallel) || 1,
          planId: form.planId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to create user');
      setShowCreate(false);
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const onRemove = async (id: string) => {
    if (!confirm('Delete this user? This cannot be undone.')) return;
    const res = await flowFetch(`/api/reseller/users/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      alert(data.error || 'Failed');
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
    try {
      const res = await flowFetch('/api/reseller/users/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Bulk delete failed');
      if (Array.isArray(data.skipped) && data.skipped.length) {
        alert(`Deleted ${data.deletedCount || 0}; skipped ${data.skipped.length}`);
      }
      setSelected(new Set());
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Bulk delete failed');
    } finally {
      setBulkBusy(false);
    }
  };

  const onSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMsg('');
    try {
      const body: Record<string, string> = { displayName: profileForm.displayName };
      if (profileForm.newPassword) {
        body.currentPassword = profileForm.currentPassword;
        body.newPassword = profileForm.newPassword;
      }
      const res = await flowFetch('/api/reseller/profile', {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed');
      setMe({
        username: data.reseller?.username || me?.username || '',
        displayName: data.reseller?.displayName || '',
      });
      setProfileForm((f) => ({ ...f, currentPassword: '', newPassword: '' }));
      setProfileMsg('Saved');
    } catch (err: unknown) {
      setProfileMsg(err instanceof Error ? err.message : 'Failed');
    } finally {
      setProfileSaving(false);
    }
  };

  const onLogout = () => {
    clearSession();
    router.push('/auth/login');
  };

  if (error) {
    return (
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6">
        <p className="text-sm text-rose-400">{error}</p>
        <button type="button" className="btn-secondary w-fit" onClick={() => load()}>
          Retry
        </button>
        <button type="button" className="btn-secondary w-fit" onClick={onLogout}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-5 bg-[var(--bg)] p-6 text-[var(--ink)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Reseller dashboard</h1>
          <p className="text-[13px] text-[var(--ink3)]">
            {me ? (
              <>
                Signed in as <span className="text-[var(--ink2)]">{me.username}</span>
                {me.displayName ? ` · ${me.displayName}` : ''}
              </>
            ) : (
              'Manage your end users via Flow Creator Ai API'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary !px-3 !py-2 !text-xs" onClick={() => setShowProfile(true)}>
            <User className="h-3.5 w-3.5" />
            Profile
          </button>
          <button type="button" className="btn-primary !px-3 !py-2 !text-xs" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            Add user
          </button>
          <button type="button" className="btn-secondary !px-3 !py-2 !text-xs" onClick={onLogout}>
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </div>

      {seatGrants.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {seatGrants.map((g) => (
            <span
              key={g.planId}
              className="rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-xs text-[var(--ink2)]"
            >
              {g.seatsUsed ?? 0}/{g.seatsAllocated} {g.planName || 'Plan'}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          className={`${inputClass} max-w-xs`}
          placeholder="Search users…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">Status: All</option>
          <option value="active">Status: Active</option>
          <option value="banned">Status: Banned</option>
          <option value="expired">Status: Expired</option>
        </select>
        <select className={selectClass} value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
          <option value="all">Plan: All</option>
          {seatGrants.map((g) => (
            <option key={g.planId} value={g.planId}>
              Plan: {g.planName || g.planId}
            </option>
          ))}
        </select>
      </div>

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

      <section className="overflow-hidden rounded-2xl border border-[var(--line)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--bg2)] px-4 py-3">
          <h2 className="text-sm font-semibold">Your users</h2>
          <span className="text-xs text-[var(--ink3)]">{users.length} shown</span>
        </div>
        {loading ? (
          <p className="px-4 py-8 text-sm text-[var(--ink3)]">Loading…</p>
        ) : users.length === 0 ? (
          <p className="px-4 py-8 text-sm text-[var(--ink3)]">No users yet. Add one to get started.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-[var(--ink3)]">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all users"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                  />
                </th>
                <th className="px-4 py-3 font-medium">Username</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Credits</th>
                <th className="px-4 py-3 font-medium">Expiry</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
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
                        href={`/reseller/users/${u.id}`}
                        className="font-medium text-[var(--a1)] hover:underline"
                      >
                        {u.username}
                      </Link>
                      {u.displayName ? (
                        <span className="mt-0.5 block text-xs text-[var(--ink3)]">{u.displayName}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs">{u.plan || '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{u.credits}</td>
                    <td className="px-4 py-3 text-xs">
                      {u.planExpiry ? new Date(u.planExpiry).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {u.banned ? 'Banned' : !u.isActive ? 'Inactive' : expired ? 'Expired' : 'Active'}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Link
                        href={`/reseller/users/${u.id}`}
                        className="mr-2 text-xs text-[var(--a1)] hover:underline"
                      >
                        Edit
                      </Link>
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-[var(--ink3)] hover:text-rose-400"
                        title="Delete"
                        onClick={() => onRemove(u.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={onCreate}
            className="w-full max-w-md space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5"
          >
            <h3 className="text-base font-semibold">Add user</h3>
            <label className="block text-xs text-[var(--ink3)]">
              Username
              <input
                required
                className={`${inputClass} mt-1`}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </label>
            <label className="block text-xs text-[var(--ink3)]">
              Password
              <input
                required
                type="password"
                minLength={4}
                className={`${inputClass} mt-1`}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>
            <label className="block text-xs text-[var(--ink3)]">
              Display name
              <input
                className={`${inputClass} mt-1`}
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </label>
            <label className="block text-xs text-[var(--ink3)]">
              Plan
              <select
                required
                className={`${inputClass} mt-1`}
                value={form.planId}
                onChange={(e) => onPlanChange(e.target.value)}
              >
                <option value="">Select plan</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id} disabled={(p.seatsRemaining ?? 0) <= 0}>
                    {p.name} ({p.seatsUsed ?? 0}/{p.seatsAllocated ?? 0} seats)
                    {hardStd[p.name] != null ? ` · ${hardStd[p.name].toLocaleString()} STD` : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-[var(--ink3)]">
                Credits
                <input
                  type="number"
                  className={`${inputClass} mt-1`}
                  value={form.credits}
                  onChange={(e) => setForm({ ...form, credits: e.target.value })}
                />
              </label>
              <label className="block text-xs text-[var(--ink3)]">
                Max parallel
                <input
                  type="number"
                  min={1}
                  className={`${inputClass} mt-1`}
                  value={form.maxParallel}
                  onChange={(e) => setForm({ ...form, maxParallel: e.target.value })}
                />
              </label>
            </div>
            <label className="block text-xs text-[var(--ink3)]">
              Plan expiry
              <input
                type="date"
                className={`${inputClass} mt-1`}
                value={form.planExpiry}
                onChange={(e) => setForm({ ...form, planExpiry: e.target.value })}
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary !px-3 !py-2 !text-xs" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary !px-3 !py-2 !text-xs" disabled={saving}>
                {saving ? 'Saving…' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={onSaveProfile}
            className="w-full max-w-md space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5"
          >
            <h3 className="text-base font-semibold">Profile</h3>
            <p className="text-xs text-[var(--ink3)]">Username: {me?.username}</p>
            {seatGrants.length > 0 && (
              <p className="text-xs text-[var(--ink2)]">
                Quotas:{' '}
                {seatGrants
                  .map((g) => `${g.seatsUsed ?? 0}/${g.seatsAllocated} ${g.planName || ''}`)
                  .join(' · ')}
              </p>
            )}
            <label className="block text-xs text-[var(--ink3)]">
              Display name
              <input
                className={`${inputClass} mt-1`}
                value={profileForm.displayName}
                onChange={(e) => setProfileForm({ ...profileForm, displayName: e.target.value })}
              />
            </label>
            <label className="block text-xs text-[var(--ink3)]">
              Current password (for password change)
              <input
                type="password"
                className={`${inputClass} mt-1`}
                value={profileForm.currentPassword}
                onChange={(e) => setProfileForm({ ...profileForm, currentPassword: e.target.value })}
              />
            </label>
            <label className="block text-xs text-[var(--ink3)]">
              New password
              <input
                type="password"
                className={`${inputClass} mt-1`}
                value={profileForm.newPassword}
                onChange={(e) => setProfileForm({ ...profileForm, newPassword: e.target.value })}
              />
            </label>
            {profileMsg && <p className="text-xs text-[var(--a1)]">{profileMsg}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary !px-3 !py-2 !text-xs" onClick={() => setShowProfile(false)}>
                Close
              </button>
              <button type="submit" className="btn-primary !px-3 !py-2 !text-xs" disabled={profileSaving}>
                {profileSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
