'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Plus, Save } from 'lucide-react';

type Plan = {
  id: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  contactSeller?: boolean;
  maxParallel: number;
  standardCreditsCycle: number;
  proCreditsCycle: number;
  features?: string[] | null;
  isActive: boolean;
};

type ModelPriceRow = {
  modelKey: string;
  displayName: string;
  mediaType: string;
  walletType: string;
  defaultPrice: number;
  price: number;
};

const inputClass =
  'w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--a1)]';

const emptyForm = {
  name: '',
  description: '',
  featuresText: '',
  priceMonthly: 0,
  maxParallel: 1,
  standardCreditsCycle: 0,
  proCreditsCycle: 0,
  isActive: true,
  contactSeller: false,
};

function featuresToText(features: unknown): string {
  if (Array.isArray(features)) return features.map(String).join('\n');
  return '';
}

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [msg, setMsg] = useState('');
  const [models, setModels] = useState<ModelPriceRow[]>([]);
  const [savingPrices, setSavingPrices] = useState(false);
  const [priceMsg, setPriceMsg] = useState('');

  const load = async () => {
    try {
      const [plansRes, pricesRes] = await Promise.all([
        fetch('/api/admin/plans'),
        fetch('/api/admin/model-prices'),
      ]);
      if (plansRes.ok) {
        const data = await plansRes.json();
        setPlans(data.plans || []);
      }
      if (pricesRes.ok) {
        const data = await pricesRes.json();
        setModels(data.models || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openEdit = (p: Plan) => {
    setEditing(p);
    setShowCreate(false);
    setForm({
      name: p.name,
      description: p.description || '',
      featuresText: featuresToText(p.features),
      priceMonthly: p.priceMonthly,
      maxParallel: p.maxParallel,
      standardCreditsCycle: p.standardCreditsCycle,
      proCreditsCycle: p.proCreditsCycle,
      isActive: p.isActive,
      contactSeller: !!p.contactSeller,
    });
  };

  const openCreate = () => {
    setEditing(null);
    setShowCreate(true);
    setForm(emptyForm);
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    try {
      const res = await fetch(editing ? `/api/admin/plans/${editing.id}` : '/api/admin/plans', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          featuresText: form.featuresText,
          priceMonthly: form.priceMonthly,
          maxParallel: form.maxParallel,
          standardCreditsCycle: form.standardCreditsCycle,
          proCreditsCycle: form.proCreditsCycle,
          isActive: form.isActive,
          contactSeller: form.contactSeller,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setMsg('Plan saved — live on pricing, homepage, and billing.');
      setShowCreate(false);
      setEditing(null);
      await load();
    } catch (err: any) {
      setMsg(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const onSavePrices = async (e: FormEvent) => {
    e.preventDefault();
    setSavingPrices(true);
    setPriceMsg('');
    try {
      const res = await fetch('/api/admin/model-prices', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          models: models.map((m) => ({ modelKey: m.modelKey, price: m.price })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setModels(data.models || models);
      setPriceMsg('Model credit prices saved — apply to new generations.');
    } catch (err: any) {
      setPriceMsg(err.message || 'Save failed');
    } finally {
      setSavingPrices(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--ink3)]">
          Catalog plans, Contact Your Seller, and global model credit costs.
        </p>
        <button type="button" className="btn-primary !text-[13px]" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" />
          New plan
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--ink3)]">Loading plans…</p>
      ) : (
        <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--card)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  {['PLAN', 'PRICE', 'SLOTS', 'STANDARD CR', 'PRO CR', 'STATUS', ''].map((h) => (
                    <th key={h} className="px-4 py-3 font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className="border-t border-[var(--line)]">
                    <td className="px-4 py-3 font-medium">{p.name}</td>
                    <td className="px-4 py-3 font-mono text-[12px]">
                      {p.contactSeller ? 'Contact Your Seller' : `$${p.priceMonthly}`}
                    </td>
                    <td className="px-4 py-3 font-mono">{p.maxParallel}</td>
                    <td className="px-4 py-3 font-mono">{p.standardCreditsCycle}</td>
                    <td className="px-4 py-3 font-mono">{p.proCreditsCycle}</td>
                    <td className="px-4 py-3">
                      <span
                        className="rounded-full px-2 py-0.5 font-mono text-[10px]"
                        style={{
                          background: p.isActive ? 'var(--a1soft)' : 'var(--bg2)',
                          color: p.isActive ? 'var(--a1)' : 'var(--ink3)',
                        }}
                      >
                        {p.isActive ? 'ACTIVE' : 'OFF'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" className="btn-secondary !px-3 !py-1.5 !text-xs" onClick={() => openEdit(p)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(showCreate || editing) && (
        <form
          onSubmit={onSave}
          className="grid gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6 sm:grid-cols-2"
        >
          <h3 className="sm:col-span-2 text-base font-semibold">
            {editing ? `Edit ${editing.name}` : 'Create plan'}
          </h3>
          <label className="text-sm">
            <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">NAME</span>
            <input required className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">PRICE / MO</span>
            <input
              type="number"
              min={0}
              step="0.01"
              disabled={form.contactSeller}
              className={inputClass}
              value={form.priceMonthly}
              onChange={(e) => setForm({ ...form, priceMonthly: Number(e.target.value) })}
            />
          </label>
          <label className="sm:col-span-2 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.contactSeller}
              onChange={(e) => setForm({ ...form, contactSeller: e.target.checked })}
            />
            <span>
              <span className="font-medium">Contact Your Seller</span>
              <span className="mt-0.5 block text-xs text-[var(--ink3)]">
                Public pricing shows that text instead of a dollar amount, and hides the signup/checkout button.
              </span>
            </span>
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">MAX PARALLEL</span>
            <input
              type="number"
              min={1}
              className={inputClass}
              value={form.maxParallel}
              onChange={(e) => setForm({ ...form, maxParallel: Number(e.target.value) })}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">STANDARD CREDITS</span>
            <input
              type="number"
              min={0}
              className={inputClass}
              value={form.standardCreditsCycle}
              onChange={(e) => setForm({ ...form, standardCreditsCycle: Number(e.target.value) })}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">PRO CREDITS</span>
            <input
              type="number"
              min={0}
              className={inputClass}
              value={form.proCreditsCycle}
              onChange={(e) => setForm({ ...form, proCreditsCycle: Number(e.target.value) })}
            />
          </label>
          <label className="flex items-end gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Active (visible on pricing / homepage / checkout)
          </label>
          <label className="sm:col-span-2 text-sm">
            <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">DESCRIPTION</span>
            <textarea
              rows={2}
              className={inputClass}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          <label className="sm:col-span-2 text-sm">
            <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
              FEATURE BULLETS (one per line)
            </span>
            <textarea
              rows={4}
              className={inputClass}
              placeholder={'Omni Flash & Whisk\nPriority lane\nCommercial licence'}
              value={form.featuresText}
              onChange={(e) => setForm({ ...form, featuresText: e.target.value })}
            />
          </label>
          {msg && <p className="sm:col-span-2 text-sm text-[var(--a1)]">{msg}</p>}
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setShowCreate(false);
                setEditing(null);
              }}
            >
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : 'Save plan'}
            </button>
          </div>
        </form>
      )}

      <form
        onSubmit={onSavePrices}
        className="flex flex-col gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6"
      >
        <div>
          <h3 className="text-base font-semibold">Model credit costs</h3>
          <p className="mt-0.5 text-[12px] text-[var(--ink3)]">
            Credits charged per generation for every user. Wallet type stays Standard / Pro as catalogued.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--line)]">
                {['MODEL', 'TYPE', 'WALLET', 'DEFAULT', 'PRICE'].map((h) => (
                  <th key={h} className="px-3 py-2 font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {models.map((m, i) => (
                <tr key={m.modelKey} className="border-t border-[var(--line)]">
                  <td className="px-3 py-2 font-medium">{m.displayName}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-[var(--ink3)]">{m.mediaType}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">{m.walletType}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-[var(--ink3)]">{m.defaultPrice}</td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min={0}
                      className={`${inputClass} max-w-[100px]`}
                      value={m.price}
                      onChange={(e) => {
                        const next = [...models];
                        next[i] = { ...m, price: Number(e.target.value) };
                        setModels(next);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {priceMsg && <p className="text-sm text-[var(--a1)]">{priceMsg}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={savingPrices || models.length === 0} className="btn-primary">
            <Save className="h-4 w-4" />
            {savingPrices ? 'Saving…' : 'Save model prices'}
          </button>
        </div>
      </form>
    </div>
  );
}
