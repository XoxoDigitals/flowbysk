'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { flowFetch } from '@/lib/flowApi';

type Staff = {
  id: string;
  username: string;
  displayName?: string;
  role?: string;
  isActive?: boolean;
  banned?: boolean;
  isPrimary?: boolean;
  userCount?: number;
  createdAt?: string | null;
};

const inputClass =
  'w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--a1)]';

export default function SystemUsersPage() {
  const [users, setUsers] = useState<Staff[]>([]);
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);
  const [pwdId, setPwdId] = useState<string | null>(null);
  const [pwd, setPwd] = useState('');
  const [form, setForm] = useState({ username: '', password: '', displayName: '' });

  const load = async () => {
    const res = await flowFetch('/api/admin/system-users');
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load');
    setUsers(data.users || []);
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const res = await flowFetch('/api/admin/system-users', {
      method: 'POST',
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.error || 'Create failed');
      return;
    }
    setShow(false);
    setForm({ username: '', password: '', displayName: '' });
    await load();
  };

  const toggle = async (u: Staff) => {
    if (u.isPrimary) return;
    const res = await flowFetch(`/api/admin/system-users/${u.id}`, {
      method: 'PUT',
      body: JSON.stringify({ isActive: u.isActive === false, banned: u.isActive !== false }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.error || 'Update failed');
      return;
    }
    await load();
  };

  const ban = async (u: Staff) => {
    if (u.isPrimary) return;
    const banned = !u.banned;
    const res = await flowFetch(`/api/admin/system-users/${u.id}`, {
      method: 'PUT',
      body: JSON.stringify({ banned, isActive: !banned }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.error || 'Ban update failed');
      return;
    }
    await load();
  };

  const savePassword = async (u: Staff) => {
    if (!pwd.trim()) return;
    const res = await flowFetch(`/api/admin/system-users/${u.id}`, {
      method: 'PUT',
      body: JSON.stringify({ password: pwd }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.error || 'Password update failed');
      return;
    }
    setPwdId(null);
    setPwd('');
    await load();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <button type="button" onClick={() => setShow(true)} className="btn-primary !px-3 !py-2 !text-xs">
          <Plus className="h-3.5 w-3.5" />
          Add staff
        </button>
      </div>
      {error && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
          {error}
        </p>
      )}
      {show && (
        <form
          onSubmit={save}
          className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 sm:grid-cols-2"
        >
          <label className="text-sm">
            <span className="mb-1 block text-[var(--ink3)]">Username</span>
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
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-[var(--ink3)]">Display name</span>
            <input
              className={inputClass}
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </label>
          <div className="sm:col-span-2 flex gap-2">
            <button type="submit" className="btn-primary !px-4 !py-2 !text-xs">
              Create
            </button>
            <button
              type="button"
              className="btn-secondary !px-4 !py-2 !text-xs"
              onClick={() => setShow(false)}
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
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Users</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-[var(--line)]">
                <td className="px-4 py-3">
                  <div className="font-medium">{u.username}</div>
                  <div className="text-[11px] text-[var(--ink3)]">{u.displayName || '—'}</div>
                  {pwdId === u.id && (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="password"
                        className={inputClass}
                        placeholder="New password"
                        value={pwd}
                        onChange={(e) => setPwd(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn-primary !px-3 !py-2 !text-xs"
                        onClick={() => savePassword(u)}
                      >
                        Set
                      </button>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">{u.role || 'ADMIN'}</td>
                <td className="px-4 py-3 font-mono">{u.userCount ?? 0}</td>
                <td className="px-4 py-3">
                  {u.banned ? 'Banned' : u.isActive === false ? 'Off' : 'Active'}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    type="button"
                    className="mr-2 text-xs text-[var(--a1)]"
                    onClick={() => {
                      setPwdId(u.id);
                      setPwd('');
                    }}
                  >
                    Password
                  </button>
                  {!u.isPrimary && (
                    <>
                      <button
                        type="button"
                        className="mr-2 text-xs text-amber-400"
                        onClick={() => ban(u)}
                      >
                        {u.banned ? 'Unban' : 'Ban'}
                      </button>
                      <button
                        type="button"
                        className="text-xs text-[var(--a1)]"
                        onClick={() => toggle(u)}
                      >
                        {u.isActive === false ? 'Activate' : 'Deactivate'}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
