'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { flowFetch } from '@/lib/flowApi';

type ServerRow = {
  id: string;
  name: string;
  targetUrl?: string;
  email?: string;
  password?: string;
  totpSecret?: string;
  hasTotp?: boolean;
  totpCode?: string | null;
  totpExpiresInSeconds?: number | null;
  isActive?: boolean;
  assignedUserCount?: number;
};

const inputClass =
  'w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--a1)]';

export default function AdminAccountsPage() {
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ServerRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState('');
  const [form, setForm] = useState({
    name: '',
    targetUrl: 'https://flow.google.com',
    email: '',
    password: '',
    totpSecret: '',
    isActive: true,
  });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await flowFetch('/api/admin/servers');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load accounts');
      setServers(data.servers || []);
      setNote(data.note || '');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({
      name: '',
      targetUrl: 'https://flow.google.com',
      email: '',
      password: '',
      totpSecret: '',
      isActive: true,
    });
    setPreview('');
    setShowForm(true);
  };

  const openEdit = (s: ServerRow) => {
    setEditing(s);
    setForm({
      name: s.name || '',
      targetUrl: s.targetUrl || 'https://flow.google.com',
      email: s.email || '',
      password: s.password || '',
      totpSecret: s.totpSecret || '',
      isActive: s.isActive !== false,
    });
    setPreview('');
    setShowForm(true);
  };

  const previewTotp = async () => {
    setPreview('');
    const res = await flowFetch('/api/admin/servers/totp-preview', {
      method: 'POST',
      body: JSON.stringify({ secret: form.totpSecret }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.error || 'Invalid authenticator secret');
      return;
    }
    setPreview(`${data.code} · ${data.expiresInSeconds}s left`);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { ...form };
      let res: Response;
      if (editing) {
        res = await flowFetch(`/api/admin/servers/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        res = await flowFetch('/api/admin/servers', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
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

  const remove = async (s: ServerRow) => {
    if (!confirm(`Delete ${s.name}?`)) return;
    const res = await flowFetch(`/api/admin/servers/${s.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.error || 'Delete failed');
      return;
    }
    await load();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-[13px] text-[var(--ink3)]">
          {note || 'Shared Google accounts with email, password, and TOTP for Flow Browser auto-login.'}
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={load} className="btn-secondary !px-3 !py-2 !text-xs">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button type="button" onClick={openCreate} className="btn-primary !px-3 !py-2 !text-xs">
            <Plus className="h-3.5 w-3.5" />
            Add account
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
          {error}
        </p>
      )}

      {showForm && (
        <form
          onSubmit={save}
          className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 sm:grid-cols-2"
        >
          <h3 className="sm:col-span-2 text-[15px] font-semibold">
            {editing ? `Edit ${editing.name}` : 'Add Google shared account'}
          </h3>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--ink3)]">Name</span>
            <input
              required
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--ink3)]">Target URL</span>
            <input
              className={inputClass}
              value={form.targetUrl}
              onChange={(e) => setForm({ ...form, targetUrl: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--ink3)]">Google email</span>
            <input
              className={inputClass}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--ink3)]">Google password</span>
            <input
              type="password"
              className={inputClass}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </label>
          <label className="sm:col-span-2 text-sm">
            <span className="mb-1 block text-[var(--ink3)]">Authenticator secret (base32)</span>
            <div className="flex gap-2">
              <input
                className={inputClass}
                value={form.totpSecret}
                onChange={(e) => setForm({ ...form, totpSecret: e.target.value })}
                placeholder="Paste TOTP secret"
              />
              <button type="button" className="btn-secondary !px-3 !py-2 !text-xs" onClick={previewTotp}>
                Preview
              </button>
            </div>
            {preview && <p className="mt-1 font-mono text-xs text-emerald-400">{preview}</p>}
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
              {saving ? 'Saving…' : 'Save'}
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

      <div className="grid gap-3 sm:grid-cols-2">
        {loading && !servers.length ? (
          <p className="text-sm text-[var(--ink3)]">Loading accounts…</p>
        ) : (
          servers.map((s) => (
            <div
              key={s.id}
              className="flex flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-[15px] font-semibold">{s.name}</h3>
                  <p className="text-[12px] text-[var(--ink3)]">{s.email || 'No email'}</p>
                </div>
                <span className="font-mono text-xs text-[var(--ink3)]">
                  {s.assignedUserCount ?? 0} users
                </span>
              </div>
              <div className="flex flex-wrap gap-2 text-[12px]">
                {s.hasTotp ? (
                  <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-emerald-400">
                    TOTP {s.totpCode || 'ready'}
                    {s.totpExpiresInSeconds != null ? ` · ${s.totpExpiresInSeconds}s` : ''}
                  </span>
                ) : (
                  <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-amber-400">
                    No TOTP
                  </span>
                )}
                {s.isActive === false ? (
                  <span className="rounded-md bg-[var(--bg2)] px-2 py-0.5 text-[var(--ink3)]">Off</span>
                ) : (
                  <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-emerald-400">Active</span>
                )}
              </div>
              <div className="mt-auto flex gap-2">
                <button
                  type="button"
                  className="btn-secondary !px-3 !py-1.5 !text-xs"
                  onClick={() => openEdit(s)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-[var(--ink3)] hover:text-rose-400"
                  onClick={() => remove(s)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
