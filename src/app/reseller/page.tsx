'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Plus, Trash2, User } from 'lucide-react';

type Seat = {
  planId: string;
  planName: string;
  allocated: number;
  used: number;
  remaining: number;
};
type Row = {
  assignmentId: string;
  id: string;
  email: string;
  name: string | null;
  planId?: string;
  planName: string;
  displayPrice: number;
  addedAt: string;
};

const inputClass =
  'w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--a1)]';

export default function ResellerDashboardPage() {
  const router = useRouter();
  const [seats, setSeats] = useState<Seat[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [editUser, setEditUser] = useState<Row | null>(null);
  const [editPlanId, setEditPlanId] = useState('');
  const [editPrice, setEditPrice] = useState(0);
  const [editPassword, setEditPassword] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [me, setMe] = useState<{ email: string; name: string | null } | null>(null);
  const [profileForm, setProfileForm] = useState({
    name: '',
    currentPassword: '',
    newPassword: '',
  });
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    planId: '',
    displayPrice: 0,
    days: 30,
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRemoving, setBulkRemoving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [usersRes, meRes] = await Promise.all([
        fetch('/api/reseller/users'),
        fetch('/api/profile'),
      ]);
      const data = await usersRes.json();
      if (!usersRes.ok) throw new Error(data.error || 'Forbidden');
      setSeats(data.seats || []);
      setUsers(data.users || []);
      setSelectedIds(new Set());
      if (!form.planId && data.seats?.[0]) {
        setForm((f) => ({ ...f, planId: data.seats[0].planId }));
      }
      if (meRes.ok) {
        const p = await meRes.json();
        setMe(p.user);
        setProfileForm((f) => ({ ...f, name: p.user?.name || '' }));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/reseller/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setShowCreate(false);
      setForm({ email: '', password: '', name: '', planId: form.planId, displayPrice: 0, days: 30 });
      await load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const onRemove = async (assignmentId: string) => {
    if (!confirm('Remove this user? Same-day remove restores a seat and will not count for your admin.')) return;
    const res = await fetch(`/api/reseller/users?assignmentId=${assignmentId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed');
      return;
    }
    await load();
  };

  const allSelected = users.length > 0 && users.every((u) => selectedIds.has(u.assignmentId));

  const toggleSelect = (assignmentId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(assignmentId)) next.delete(assignmentId);
      else next.add(assignmentId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(users.map((u) => u.assignmentId)));
  };

  const onBulkRemove = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (
      !confirm(
        `Remove ${ids.length} user(s)? Same-day removes restore seats and will not count for your admin.`
      )
    ) {
      return;
    }
    setBulkRemoving(true);
    try {
      const res = await fetch('/api/reseller/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      const failedN = Array.isArray(data.failed) ? data.failed.length : 0;
      if (failedN > 0) {
        alert(`Removed ${data.removed || 0}; ${failedN} failed.`);
      }
      setSelectedIds(new Set());
      await load();
    } catch (err: any) {
      alert(err.message || 'Failed');
    } finally {
      setBulkRemoving(false);
    }
  };

  const openEdit = (u: Row) => {
    setEditUser(u);
    setEditPlanId(u.planId || seats.find((s) => s.planName === u.planName)?.planId || '');
    setEditPrice(u.displayPrice);
    setEditPassword('');
  };

  const saveUserPlan = async () => {
    if (!editUser) return;
    setEditSaving(true);
    try {
      const res = await fetch('/api/reseller/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'change_plan',
          assignmentId: editUser.assignmentId,
          planId: editPlanId,
          displayPrice: editPrice,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      await load();
      alert('Plan updated');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setEditSaving(false);
    }
  };

  const saveUserPassword = async () => {
    if (!editUser) return;
    if (editPassword.length < 6) {
      alert('Password min 6 chars');
      return;
    }
    setEditSaving(true);
    try {
      const res = await fetch('/api/reseller/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'password',
          assignmentId: editUser.assignmentId,
          password: editPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setEditPassword('');
      alert('Password updated');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setEditSaving(false);
    }
  };

  const onSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMsg('');
    try {
      const body: Record<string, string> = { name: profileForm.name };
      if (profileForm.newPassword) {
        body.currentPassword = profileForm.currentPassword;
        body.newPassword = profileForm.newPassword;
      }
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setMe(data.user);
      setProfileForm((f) => ({ ...f, currentPassword: '', newPassword: '' }));
      setProfileMsg('Saved');
    } catch (err: any) {
      setProfileMsg(err.message);
    } finally {
      setProfileSaving(false);
    }
  };

  const onLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/auth/login');
  };

  if (error) {
    return <p className="p-6 text-sm text-rose-400">{error}</p>;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-5 bg-[var(--bg)] p-6 text-[var(--ink)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Reseller dashboard</h1>
          <p className="text-[13px] text-[var(--ink3)]">
            {me ? (
              <>
                Signed in as <span className="text-[var(--ink2)]">{me.email}</span>
              </>
            ) : (
              'Add users from your allocated seats'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.size > 0 && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-[11px] border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-500 transition hover:bg-rose-500/20 disabled:opacity-50"
              disabled={bulkRemoving}
              onClick={onBulkRemove}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {bulkRemoving ? 'Removing…' : `Remove selected (${selectedIds.size})`}
            </button>
          )}
          <button type="button" className="btn-secondary !text-[13px]" onClick={() => setShowProfile(true)}>
            <User className="h-3.5 w-3.5" />
            Profile
          </button>
          <button type="button" className="btn-secondary !text-[13px]" onClick={onLogout}>
            <LogOut className="h-3.5 w-3.5" />
            Log out
          </button>
          <button type="button" className="btn-primary !text-[13px]" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add user
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--ink3)]">Loading…</p>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            {seats.map((s) => (
              <div key={s.planId} className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
                <div className="text-sm font-semibold">{s.planName}</div>
                <div className="mt-1 font-mono text-[22px] font-semibold">{s.remaining}</div>
                <div className="text-[11px] text-[var(--ink3)]">
                  remaining of {s.allocated} · used {s.used}
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--card)]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      disabled={users.length === 0}
                      aria-label="Select all users"
                      className="h-3.5 w-3.5 accent-[var(--a1)]"
                    />
                  </th>
                  {['USER', 'PLAN', 'PRICE', 'ACTIONS'].map((h) => (
                    <th key={h} className="px-4 py-3 font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[var(--ink3)]">
                      No users yet
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.assignmentId} className="border-t border-[var(--line)]">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(u.assignmentId)}
                          onChange={() => toggleSelect(u.assignmentId)}
                          aria-label={`Select ${u.email}`}
                          className="h-3.5 w-3.5 accent-[var(--a1)]"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{u.name || u.email}</div>
                        <div className="font-mono text-[11px] text-[var(--ink3)]">{u.email}</div>
                      </td>
                      <td className="px-4 py-3">{u.planName}</td>
                      <td className="px-4 py-3 font-mono">${u.displayPrice}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="btn-secondary !px-2 !py-1 !text-[11px]"
                            onClick={() => openEdit(u)}
                          >
                            Manage
                          </button>
                          <button
                            type="button"
                            className="rounded-lg p-2 text-rose-400 hover:bg-rose-500/10"
                            onClick={() => onRemove(u.assignmentId)}
                            title="Remove"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editUser && (
        <div className="grid gap-3 rounded-[18px] border border-[var(--a1)] bg-[var(--card)] p-6 sm:grid-cols-2">
          <h3 className="sm:col-span-2 font-semibold">Manage · {editUser.email}</h3>
          <label className="text-sm">
            <span className="mb-1 block font-mono text-[10px] text-[var(--ink3)]">PLAN</span>
            <select className={inputClass} value={editPlanId} onChange={(e) => setEditPlanId(e.target.value)}>
              {seats.map((s) => {
                const isCurrent = s.planId === editUser.planId;
                const blocked = !isCurrent && s.remaining <= 0;
                return (
                  <option key={s.planId} value={s.planId} disabled={blocked}>
                    {s.planName}
                    {isCurrent ? ' (current)' : ` (${s.remaining} left)`}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-mono text-[10px] text-[var(--ink3)]">DISPLAY PRICE ($)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className={inputClass}
              value={editPrice}
              onChange={(e) => setEditPrice(Number(e.target.value))}
            />
          </label>
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <button type="button" disabled={editSaving} className="btn-primary !text-xs" onClick={saveUserPlan}>
              {editSaving ? 'Saving…' : 'Save plan'}
            </button>
          </div>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-mono text-[10px] text-[var(--ink3)]">NEW PASSWORD FOR USER</span>
            <input
              type="text"
              className={inputClass}
              value={editPassword}
              onChange={(e) => setEditPassword(e.target.value)}
              placeholder="Min 6 characters"
            />
          </label>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" className="btn-secondary !text-xs" onClick={() => setEditUser(null)}>
              Close
            </button>
            <button type="button" disabled={editSaving} className="btn-secondary !text-xs" onClick={saveUserPassword}>
              Set password
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={onCreate}
          className="grid gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6 sm:grid-cols-2"
        >
          <h3 className="sm:col-span-2 font-semibold">Add customer</h3>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-mono text-[10px] text-[var(--ink3)]">EMAIL</span>
            <input required type="email" className={inputClass} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-mono text-[10px] text-[var(--ink3)]">PASSWORD</span>
            <input required minLength={6} className={inputClass} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-mono text-[10px] text-[var(--ink3)]">NAME</span>
            <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-mono text-[10px] text-[var(--ink3)]">PLAN</span>
            <select
              required
              className={inputClass}
              value={form.planId}
              onChange={(e) => setForm({ ...form, planId: e.target.value })}
            >
              {seats.map((s) => (
                <option key={s.planId} value={s.planId} disabled={s.remaining <= 0}>
                  {s.planName} ({s.remaining} left)
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-mono text-[10px] text-[var(--ink3)]">DISPLAY PRICE ($)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className={inputClass}
              value={form.displayPrice}
              onChange={(e) => setForm({ ...form, displayPrice: Number(e.target.value) })}
            />
          </label>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : 'Create'}
            </button>
          </div>
        </form>
      )}

      {showProfile && (
        <form
          onSubmit={onSaveProfile}
          className="grid gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6 sm:grid-cols-2"
        >
          <h3 className="sm:col-span-2 font-semibold">Profile & password</h3>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-mono text-[10px] text-[var(--ink3)]">EMAIL</span>
            <input className={inputClass} value={me?.email || ''} disabled />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-mono text-[10px] text-[var(--ink3)]">DISPLAY NAME</span>
            <input
              className={inputClass}
              value={profileForm.name}
              onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-mono text-[10px] text-[var(--ink3)]">CURRENT PASSWORD</span>
            <input
              type="password"
              className={inputClass}
              value={profileForm.currentPassword}
              onChange={(e) => setProfileForm({ ...profileForm, currentPassword: e.target.value })}
              autoComplete="current-password"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-mono text-[10px] text-[var(--ink3)]">NEW PASSWORD</span>
            <input
              type="password"
              minLength={8}
              className={inputClass}
              value={profileForm.newPassword}
              onChange={(e) => setProfileForm({ ...profileForm, newPassword: e.target.value })}
              autoComplete="new-password"
              placeholder="Min 8 chars"
            />
          </label>
          {profileMsg && (
            <p className="sm:col-span-2 text-xs text-[var(--a1)]">{profileMsg}</p>
          )}
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setShowProfile(false)}>
              Close
            </button>
            <button type="submit" disabled={profileSaving} className="btn-primary">
              {profileSaving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
