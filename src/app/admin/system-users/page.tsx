'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Plus, Save } from 'lucide-react';

type StaffUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  createdAt: string;
  ownedCustomers: number;
};

const inputClass =
  'w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--a1)]';

export default function SystemUsersPage() {
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', name: '' });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/system-users');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Forbidden');
      setUsers(data.users || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/system-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setShowCreate(false);
      setForm({ email: '', password: '', name: '' });
      await load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleBan = async (u: StaffUser) => {
    if (u.role === 'SUPER_ADMIN') return;
    const next = u.status === 'BANNED' ? 'ACTIVE' : 'BANNED';
    if (!confirm(`${next === 'BANNED' ? 'Disable' : 'Enable'} ${u.email}?`)) return;
    const res = await fetch(`/api/admin/system-users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || 'Failed');
      return;
    }
    await load();
  };

  if (error) {
    return <p className="text-sm text-rose-400">{error} — Super Admin only.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--ink3)]">
          Create sub-admins. They can do everything except this page and removing other admins.
        </p>
        <button type="button" className="btn-primary !text-[13px]" onClick={() => setShowCreate(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add sub-admin
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--ink3)]">Loading…</p>
      ) : (
        <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--card)]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--line)]">
                {['NAME', 'EMAIL', 'ROLE', 'OWNED USERS', 'STATUS', ''].map((h) => (
                  <th key={h} className="px-4 py-3 font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-[var(--line)]">
                  <td className="px-4 py-3 font-medium">{u.name || '—'}</td>
                  <td className="px-4 py-3 font-mono text-[12px]">{u.email}</td>
                  <td className="px-4 py-3 font-mono text-[11px]">{u.role}</td>
                  <td className="px-4 py-3 font-mono">{u.ownedCustomers}</td>
                  <td className="px-4 py-3">{u.status}</td>
                  <td className="px-4 py-3 text-right">
                    {u.role !== 'SUPER_ADMIN' && (
                      <button
                        type="button"
                        className="btn-secondary !px-3 !py-1.5 !text-xs"
                        onClick={() => toggleBan(u)}
                      >
                        {u.status === 'BANNED' ? 'Enable' : 'Disable'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={onCreate}
          className="grid max-w-lg gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6"
        >
          <h3 className="font-semibold">New sub-admin</h3>
          <label className="text-sm">
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
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : 'Create'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
