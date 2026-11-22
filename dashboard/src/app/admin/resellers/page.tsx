'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { flowFetch } from '@/lib/flowApi';

type SeatGrant = {
  id?: string;
  planId: string;
  planName?: string;
  monthKey?: string;
  seatsAllocated: number;
  seatsUsed?: number;
  wholesalePrice?: number;
};

type SeatRow = { planId: string; seatQuota: string };

type Reseller = {
  id: string;
  username: string;
  displayName?: string;
  isActive?: boolean;
  banned?: boolean;
  notes?: string;
  userCount?: number;
  createdAt?: string;
  seatGrants?: SeatGrant[];
};

type PlanRow = { id: string; name: string };

const inputClass =
  'w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--a1)]';

export default function AdminResellersPage() {
  const [rows, setRows] = useState<Reseller[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<Reseller | null>(null);
  const [form, setForm] = useState({
    username: '',
    password: '',
    displayName: '',
    notes: '',
    isActive: true,
  });
  const [seatRows, setSeatRows] = useState<SeatRow[]>([{ planId: '', seatQuota: '10' }]);

  const load = async () => {
    const [rRes, pRes] = await Promise.all([
      flowFetch('/api/admin/resellers'),
      flowFetch('/api/admin/plans'),
    ]);
    const data = await rRes.json();
    if (!rRes.ok || !data.success) throw new Error(data.error || 'Failed to load');
    setRows(data.resellers || []);
    if (pRes.ok) {
      const pd = await pRes.json();
      if (pd.success) setPlans(pd.plans || []);
    }
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const openCreate = () => {
    setEditing(null);
    const starter = plans.find((p) => /^starter$/i.test(p.name)) || plans[0];
    setForm({
      username: '',
      password: '',
      displayName: '',
      notes: '',
      isActive: true,
    });
    setSeatRows([{ planId: starter?.id || '', seatQuota: '10' }]);
    setShow(true);
  };

  const openEdit = (r: Reseller) => {
    setEditing(r);
    setForm({
      username: r.username,
      password: '',
      displayName: r.displayName || '',
      notes: r.notes || '',
      isActive: r.isActive !== false && !r.banned,
    });
    const grants = r.seatGrants || [];
    setSeatRows(
      grants.length
        ? grants.map((g) => ({
            planId: g.planId,
            seatQuota: String(g.seatsAllocated ?? 0),
          }))
        : [{ planId: plans[0]?.id || '', seatQuota: '10' }]
    );
    setShow(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const seen = new Set<string>();
    const seatGrants: { planId: string; seatsAllocated: number }[] = [];
    for (const row of seatRows) {
      if (!row.planId) continue;
      if (seen.has(row.planId)) {
        setError('Each plan can only appear once in seat quotas');
        return;
      }
      seen.add(row.planId);
      seatGrants.push({
        planId: row.planId,
        seatsAllocated: Math.max(0, Number(row.seatQuota) || 0),
      });
    }
    const payload: Record<string, unknown> = {
      displayName: form.displayName,
      notes: form.notes,
      isActive: form.isActive,
      banned: !form.isActive ? undefined : false,
      seatGrants,
    };
    if (form.password.trim()) payload.password = form.password;
    let res: Response;
    if (editing) {
      res = await flowFetch(`/api/admin/resellers/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } else {
      res = await flowFetch('/api/admin/resellers', {
        method: 'POST',
        body: JSON.stringify({
          username: form.username.trim(),
          password: form.password,
          ...payload,
        }),
      });
    }
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.error || 'Save failed');
      return;
    }
    setShow(false);
    await load();
  };

  const toggleBan = async (r: Reseller) => {
    const banned = !r.banned;
    const res = await flowFetch(`/api/admin/resellers/${r.id}`, {
      method: 'PUT',
      body: JSON.stringify({ banned, isActive: !banned }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.error || 'Update failed');
      return;
    }
    await load();
  };

  const remove = async (r: Reseller) => {
    if (!confirm(`Delete reseller ${r.username}?`)) return;
    const res = await flowFetch(`/api/admin/resellers/${r.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.error || 'Delete failed');
      return;
    }
    await load();
  };

  const formatQuota = (r: Reseller) => {
    const grants = r.seatGrants || [];
    if (!grants.length) return '—';
    return grants
      .map((g) => `${g.seatsUsed ?? 0}/${g.seatsAllocated} ${g.planName || ''}`.trim())
      .join(' · ');
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <button type="button" onClick={openCreate} className="btn-primary !px-3 !py-2 !text-xs">
          <Plus className="h-3.5 w-3.5" />
          Add reseller
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
          {!editing && (
            <label className="text-sm">
              <span className="mb-1 block text-[var(--ink3)]">Username</span>
              <input
                required
                className={inputClass}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </label>
          )}
          <label className="text-sm">
            <span className="mb-1 block text-[var(--ink3)]">
              {editing ? 'New password (optional)' : 'Password'}
            </span>
            <input
              type="password"
              required={!editing}
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

          <div className="sm:col-span-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--ink3)]">Plan seat quotas</span>
              <button
                type="button"
                className="text-xs text-[var(--a1)]"
                onClick={() =>
                  setSeatRows([...seatRows, { planId: plans[0]?.id || '', seatQuota: '10' }])
                }
              >
                + Add plan
              </button>
            </div>
            {seatRows.map((row, idx) => (
              <div key={idx} className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
                <select
                  className={inputClass}
                  value={row.planId}
                  onChange={(e) => {
                    const next = [...seatRows];
                    next[idx] = { ...next[idx], planId: e.target.value };
                    setSeatRows(next);
                  }}
                >
                  <option value="">Select plan</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  placeholder="Seats"
                  value={row.seatQuota}
                  onChange={(e) => {
                    const next = [...seatRows];
                    next[idx] = { ...next[idx], seatQuota: e.target.value };
                    setSeatRows(next);
                  }}
                />
                <button
                  type="button"
                  className="rounded-[11px] border border-[var(--line)] px-3 text-[var(--ink3)] hover:text-rose-400"
                  onClick={() => setSeatRows(seatRows.filter((_, i) => i !== idx))}
                  disabled={seatRows.length <= 1}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

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
          <div className="sm:col-span-2 flex gap-2">
            <button type="submit" className="btn-primary !px-4 !py-2 !text-xs">
              Save
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
              <th className="px-4 py-3">Reseller</th>
              <th className="px-4 py-3">Users</th>
              <th className="px-4 py-3">Quota</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--line)]">
                <td className="px-4 py-3">
                  <div className="font-medium">{r.username}</div>
                  <div className="text-[11px] text-[var(--ink3)]">
                    {r.displayName || r.notes || '—'}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono">{r.userCount ?? 0}</td>
                <td className="px-4 py-3 text-[13px]">{formatQuota(r)}</td>
                <td className="px-4 py-3">
                  {r.banned ? 'Banned' : r.isActive === false ? 'Off' : 'Active'}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button
                    type="button"
                    className="mr-2 text-xs text-[var(--a1)]"
                    onClick={() => openEdit(r)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="mr-2 text-xs text-amber-400"
                    onClick={() => toggleBan(r)}
                  >
                    {r.banned ? 'Unban' : 'Ban'}
                  </button>
                  <button
                    type="button"
                    className="text-[var(--ink3)] hover:text-rose-400"
                    onClick={() => remove(r)}
                  >
                    <Trash2 className="inline h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[var(--ink3)]">
                  No resellers
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
