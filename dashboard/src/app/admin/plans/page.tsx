'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { flowFetch } from '@/lib/flowApi';

type Plan = {
  id: string;
  name: string;
  credits?: number;
  price?: number;
  durationDays?: number;
  maxParallel?: number;
  isActive?: boolean;
};

const inputClass =
  'w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--a1)]';

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState({
    name: '',
    credits: '100',
    price: '0',
    durationDays: '30',
    maxParallel: '1',
  });

  const load = async () => {
    const res = await flowFetch('/api/admin/plans');
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.error || 'Failed to load plans');
      return;
    }
    setPlans(data.plans || []);
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', credits: '100', price: '0', durationDays: '30', maxParallel: '1' });
    setShow(true);
  };

  const openEdit = (p: Plan) => {
    setEditing(p);
    setForm({
      name: p.name || '',
      credits: String(p.credits ?? 0),
      price: String(p.price ?? 0),
      durationDays: String(p.durationDays ?? 30),
      maxParallel: String(p.maxParallel ?? 1),
    });
    setShow(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const payload = {
      name: form.name.trim(),
      credits: Number(form.credits) || 0,
      price: Number(form.price) || 0,
      durationDays: Number(form.durationDays) || 30,
      maxParallel: Number(form.maxParallel) || 1,
    };
    const res = editing
      ? await flowFetch(`/api/admin/plans/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      : await flowFetch('/api/admin/plans', { method: 'POST', body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.error || 'Save failed');
      return;
    }
    setShow(false);
    await load();
  };

  const remove = async (p: Plan) => {
    if (!confirm(`Delete plan ${p.name}?`)) return;
    const res = await flowFetch(`/api/admin/plans/${p.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      setError(data.error || 'Delete failed');
      return;
    }
    await load();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <button type="button" onClick={openCreate} className="btn-primary !px-3 !py-2 !text-xs">
          <Plus className="h-3.5 w-3.5" />
          Add plan
        </button>
      </div>
      {error && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
          {error}
        </p>
      )}
      {show && (
        <form onSubmit={save} className="grid gap-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-[var(--ink3)]">Name</span>
            <input required className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--ink3)]">Credits</span>
            <input className={inputClass} value={form.credits} onChange={(e) => setForm({ ...form, credits: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--ink3)]">Price</span>
            <input className={inputClass} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--ink3)]">Duration (days)</span>
            <input className={inputClass} value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--ink3)]">Max parallel</span>
            <input className={inputClass} value={form.maxParallel} onChange={(e) => setForm({ ...form, maxParallel: e.target.value })} />
          </label>
          <div className="sm:col-span-2 flex gap-2">
            <button type="submit" className="btn-primary !px-4 !py-2 !text-xs">Save</button>
            <button type="button" className="btn-secondary !px-4 !py-2 !text-xs" onClick={() => setShow(false)}>Cancel</button>
          </div>
        </form>
      )}
      <div className="overflow-hidden rounded-2xl border border-[var(--line)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--bg2)] text-[11px] uppercase tracking-wider text-[var(--ink3)]">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Credits</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Days</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className="border-t border-[var(--line)]">
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3 font-mono">{p.credits ?? 0}</td>
                <td className="px-4 py-3">{p.price ?? 0}</td>
                <td className="px-4 py-3">{p.durationDays ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <button type="button" className="mr-2 text-xs text-[var(--a1)]" onClick={() => openEdit(p)}>Edit</button>
                  <button type="button" className="text-[var(--ink3)] hover:text-rose-400" onClick={() => remove(p)}>
                    <Trash2 className="inline h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
            {!plans.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[var(--ink3)]">No plans yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
