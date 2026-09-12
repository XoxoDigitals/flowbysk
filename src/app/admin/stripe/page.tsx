'use client';

import { FormEvent, useEffect, useState } from 'react';
import { CreditCard, Save } from 'lucide-react';

const inputClass =
  'w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3.5 py-2.5 text-sm text-[var(--ink)] outline-none focus:border-[var(--a1)]';

export default function AdminStripePage() {
  const [publishableKey, setPublishableKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [configured, setConfigured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/admin/stripe')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.config) return;
        setPublishableKey(data.config.publishableKey || '');
        setSecretKey(data.config.secretKeyMasked || '');
        setWebhookSecret(data.config.webhookSecretMasked || '');
        setConfigured(Boolean(data.config.configured));
      })
      .catch(() => {});
  }, []);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    setErr('');
    try {
      const res = await fetch('/api/admin/stripe', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishableKey, secretKey, webhookSecret }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setConfigured(Boolean(data.config?.configured));
      if (data.config?.secretKeyMasked) setSecretKey(data.config.secretKeyMasked);
      if (data.config?.webhookSecretMasked) setWebhookSecret(data.config.webhookSecretMasked);
      setMsg('Stripe settings saved in database (not env).');
    } catch (error: any) {
      setErr(error.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <form
        onSubmit={onSave}
        className="flex flex-col gap-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6"
      >
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <CreditCard className="h-4 w-4 text-[var(--a1)]" />
            Stripe keys
          </h3>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">
            Stored in the database. Leave masked secret/webhook fields unchanged to keep existing values.
            {configured ? ' · Configured' : ' · Not fully configured'}
          </p>
        </div>

        <label className="text-sm">
          <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
            PUBLISHABLE KEY
          </span>
          <input
            value={publishableKey}
            onChange={(e) => setPublishableKey(e.target.value)}
            placeholder="pk_live_… or pk_test_…"
            className={inputClass}
            autoComplete="off"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
            SECRET KEY
          </span>
          <input
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder="sk_live_… or sk_test_…"
            className={inputClass}
            autoComplete="off"
          />
        </label>

        <label className="text-sm">
          <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
            WEBHOOK SECRET
          </span>
          <input
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder="whsec_…"
            className={inputClass}
            autoComplete="off"
          />
        </label>

        {msg && <p className="text-sm text-[var(--a1)]">{msg}</p>}
        {err && <p className="text-sm text-rose-400">{err}</p>}

        <button type="submit" disabled={saving} className="btn-primary self-start">
          <Save className="h-4 w-4" />
          {saving ? 'Saving…' : 'Save Stripe settings'}
        </button>
      </form>
    </div>
  );
}
