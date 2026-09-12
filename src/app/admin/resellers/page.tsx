'use client';

import { FormEvent, useEffect, useState } from 'react';
import { KeyRound, Plus, Save, Settings2, Trash2 } from 'lucide-react';

type PlanOpt = { id: string; name: string; priceMonthly: number };
type Seat = {
  planId: string;
  planName: string;
  allocated: number;
  used: number;
  remaining: number;
  wholesalePrice: number;
};
type ResellerRow = {
  id: string;
  label: string;
  isActive: boolean;
  deactivationMessage?: string | null;
  user: { id: string; email: string; name: string | null; status: string };
  parentAdmin: { email: string; name: string | null };
  seats: Seat[];
  activeUsers: {
    assignmentId?: string;
    id: string;
    email: string;
    planId?: string;
    planName: string;
    displayPrice: number;
  }[];
};

const inputClass =
  'w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--a1)]';

export default function AdminResellersPage() {
  const [resellers, setResellers] = useState<ResellerRow[]>([]);
  const [plans, setPlans] = useState<PlanOpt[]>([]);
  const [monthKey, setMonthKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  const [seatDraft, setSeatDraft] = useState<Record<string, { seats: number; wholesalePrice: number }>>({});
  const [pwdDraft, setPwdDraft] = useState('');
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    label: '',
  });
  const [grants, setGrants] = useState<Record<string, { seats: number; wholesalePrice: number }>>({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/resellers');
      if (res.ok) {
        const data = await res.json();
        setResellers(data.resellers || []);
        setPlans(data.plans || []);
        setMonthKey(data.monthKey || '');
        const init: Record<string, { seats: number; wholesalePrice: number }> = {};
        for (const p of data.plans || []) {
          init[p.id] = { seats: 0, wholesalePrice: p.priceMonthly || 0 };
        }
        setGrants(init);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openManage = (r: ResellerRow) => {
    setManageId(r.id);
    setPwdDraft('');
    const draft: Record<string, { seats: number; wholesalePrice: number }> = {};
    for (const p of plans) {
      const existing = r.seats.find((s) => s.planId === p.id);
      draft[p.id] = {
        seats: existing?.allocated ?? 0,
        wholesalePrice: existing?.wholesalePrice ?? p.priceMonthly,
      };
    }
    setSeatDraft(draft);
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const grantList = Object.entries(grants)
        .filter(([, g]) => g.seats > 0)
        .map(([planId, g]) => ({ planId, seats: g.seats, wholesalePrice: g.wholesalePrice }));
      if (!grantList.length) {
        alert('Allocate at least one plan with seats');
        return;
      }
      const res = await fetch('/api/admin/resellers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, grants: grantList }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setShowCreate(false);
      setForm({ email: '', password: '', name: '', label: '' });
      await load();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveSeats = async (id: string) => {
    const grantList = Object.entries(seatDraft).map(([planId, g]) => ({
      planId,
      seats: g.seats,
      wholesalePrice: g.wholesalePrice,
    }));
    const res = await fetch(`/api/admin/resellers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'seats', grants: grantList }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed');
      return;
    }
    await load();
    alert('Seats updated');
  };

  const resetPassword = async (id: string) => {
    if (pwdDraft.length < 6) {
      alert('Password min 6 chars');
      return;
    }
    const res = await fetch(`/api/admin/resellers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'password', password: pwdDraft }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed');
      return;
    }
    setPwdDraft('');
    alert('Password updated');
  };

  const setActive = async (r: ResellerRow, active: boolean) => {
    if (active) {
      const res = await fetch(`/api/admin/resellers/${r.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'activate' }),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || 'Failed');
      else await load();
      return;
    }

    const choice = window.prompt(
      'Deactivate reseller.\nType:\n  users = also deactivate their customers\n  keep = keep customers active\n  cancel = abort',
      'keep'
    );
    if (!choice || choice.toLowerCase() === 'cancel') return;
    const deactivateUsers = choice.toLowerCase().startsWith('u');
    const message =
      window.prompt(
        'Message shown to reseller (and to customers if kept active):',
        r.deactivationMessage || 'Your reseller account has been deactivated. Contact your admin.'
      ) ?? '';

    const res = await fetch(`/api/admin/resellers/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deactivate', deactivateUsers, message }),
    });
    const data = await res.json();
    if (!res.ok) alert(data.error || 'Failed');
    else {
      setManageId(null);
      await load();
    }
  };

  const deleteReseller = async (r: ResellerRow) => {
    const choice = window.prompt(
      `Delete reseller ${r.label}?\nType:\n  users = ban their customers too\n  keep = leave customers\n  cancel = abort`,
      'keep'
    );
    if (!choice || choice.toLowerCase() === 'cancel') return;
    const deactivateUsers = choice.toLowerCase().startsWith('u');
    const message =
      window.prompt('Optional message for remaining customers:', r.deactivationMessage || '') ?? '';

    const res = await fetch(`/api/admin/resellers/${r.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deactivateUsers, message }),
    });
    const data = await res.json();
    if (!res.ok) alert(data.error || 'Failed');
    else {
      setManageId(null);
      await load();
    }
  };

  const managed = resellers.find((r) => r.id === manageId) || null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--ink3)]">
          Your resellers · seat packs for {monthKey || 'this month'} · manage seats, password, deactivate/delete
        </p>
        <button type="button" className="btn-primary !text-[13px]" onClick={() => setShowCreate(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add reseller
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--ink3)]">Loading…</p>
      ) : resellers.length === 0 ? (
        <p className="text-sm text-[var(--ink3)]">No resellers yet.</p>
      ) : (
        <div className="grid gap-3">
          {resellers.map((r) => (
            <div key={r.id} className="rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">
                    {r.label}{' '}
                    {!r.isActive && (
                      <span className="ml-1 rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-400">
                        INACTIVE
                      </span>
                    )}
                  </h3>
                  <p className="font-mono text-[12px] text-[var(--ink3)]">{r.user.email}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary !px-3 !py-1.5 !text-xs" onClick={() => openManage(r)}>
                    <Settings2 className="h-3.5 w-3.5" />
                    Manage
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {r.seats.map((s) => (
                  <div key={s.planId} className="rounded-xl border border-[var(--line)] px-3 py-2 text-[12px]">
                    <div className="font-medium">{s.planName}</div>
                    <div className="font-mono text-[var(--ink3)]">
                      {s.remaining}/{s.allocated} seats · wholesale ${s.wholesalePrice}
                    </div>
                  </div>
                ))}
              </div>
              {r.activeUsers.length > 0 && (
                <ul className="mt-3 divide-y divide-[var(--line)] text-[12px]">
                  {r.activeUsers.map((u) => (
                    <li key={u.id} className="flex justify-between gap-2 py-1.5">
                      <span>{u.email}</span>
                      <span className="font-mono text-[var(--ink3)]">
                        {u.planName} · ${u.displayPrice}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {managed && (
        <div className="flex flex-col gap-4 rounded-[18px] border border-[var(--a1)] bg-[var(--card)] p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Manage · {managed.label}</h3>
            <button type="button" className="btn-secondary !text-xs" onClick={() => setManageId(null)}>
              Close
            </button>
          </div>

          <div>
            <p className="mb-2 font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">SEATS / WHOLESALE</p>
            <div className="grid gap-2">
              {plans
                .filter((p) => p.name !== 'Free')
                .map((p) => (
                  <div key={p.id} className="grid grid-cols-3 items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    <input
                      type="number"
                      min={0}
                      className={inputClass}
                      value={seatDraft[p.id]?.seats ?? 0}
                      onChange={(e) =>
                        setSeatDraft({
                          ...seatDraft,
                          [p.id]: {
                            seats: Number(e.target.value),
                            wholesalePrice: seatDraft[p.id]?.wholesalePrice ?? p.priceMonthly,
                          },
                        })
                      }
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className={inputClass}
                      value={seatDraft[p.id]?.wholesalePrice ?? 0}
                      onChange={(e) =>
                        setSeatDraft({
                          ...seatDraft,
                          [p.id]: {
                            seats: seatDraft[p.id]?.seats ?? 0,
                            wholesalePrice: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </div>
                ))}
            </div>
            <button type="button" className="btn-primary mt-3 !text-xs" onClick={() => saveSeats(managed.id)}>
              <Save className="h-3.5 w-3.5" />
              Save seats
            </button>
          </div>

          <div>
            <p className="mb-2 font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">RESET PASSWORD</p>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                className={`${inputClass} max-w-xs`}
                placeholder="New password"
                value={pwdDraft}
                onChange={(e) => setPwdDraft(e.target.value)}
              />
              <button type="button" className="btn-secondary !text-xs" onClick={() => resetPassword(managed.id)}>
                <KeyRound className="h-3.5 w-3.5" />
                Set password
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
            {managed.isActive ? (
              <button type="button" className="btn-secondary !text-xs" onClick={() => setActive(managed, false)}>
                Deactivate
              </button>
            ) : (
              <button type="button" className="btn-primary !text-xs" onClick={() => setActive(managed, true)}>
                Activate
              </button>
            )}
            <button
              type="button"
              className="rounded-[11px] border border-rose-500/40 px-3 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/10"
              onClick={() => deleteReseller(managed)}
            >
              <Trash2 className="mr-1 inline h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={onCreate}
          className="flex flex-col gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6"
        >
          <h3 className="font-semibold">New reseller</h3>
          <div className="grid gap-3 sm:grid-cols-2">
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
            <label className="text-sm">
              <span className="mb-1 block font-mono text-[10px] text-[var(--ink3)]">LABEL</span>
              <input className={inputClass} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </label>
          </div>
          <p className="text-[12px] text-[var(--ink3)]">Seats this month + wholesale price</p>
          <div className="grid gap-2">
            {plans
              .filter((p) => p.name !== 'Free')
              .map((p) => (
                <div key={p.id} className="grid grid-cols-3 items-center gap-2 rounded-xl border border-[var(--line)] px-3 py-2">
                  <span className="text-sm font-medium">{p.name}</span>
                  <input
                    type="number"
                    min={0}
                    placeholder="Seats"
                    className={inputClass}
                    value={grants[p.id]?.seats ?? 0}
                    onChange={(e) =>
                      setGrants({
                        ...grants,
                        [p.id]: {
                          seats: Number(e.target.value),
                          wholesalePrice: grants[p.id]?.wholesalePrice ?? p.priceMonthly,
                        },
                      })
                    }
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="Wholesale $"
                    className={inputClass}
                    value={grants[p.id]?.wholesalePrice ?? 0}
                    onChange={(e) =>
                      setGrants({
                        ...grants,
                        [p.id]: {
                          seats: grants[p.id]?.seats ?? 0,
                          wholesalePrice: Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>
              ))}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : 'Create reseller'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
