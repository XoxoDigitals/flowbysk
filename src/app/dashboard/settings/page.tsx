'use client';

import { FormEvent, useEffect, useState } from 'react';
import ThemeToggle from '@/components/ThemeToggle';
import { useTheme } from '@/components/ThemeProvider';

export default function DashboardSettingsPage() {
  const { theme } = useTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) {
          setName(data.user.name || '');
          setEmail(data.user.email || '');
        }
      })
      .catch(() => {});
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          ...(newPassword ? { currentPassword, newPassword } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      setMessage('Profile updated');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: any) {
      setError(err.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3.5">
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-5 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-[22px]"
      >
        <div>
          <h3 className="text-base font-semibold tracking-[-0.02em]">Profile</h3>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">Signed in as {email || '…'}</p>
        </div>

        <label className="block text-[13px]">
          <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
            DISPLAY NAME
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3.5 py-2.5 outline-none focus:border-[var(--a1)]"
          />
        </label>

        <label className="block text-[13px]">
          <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
            EMAIL
          </span>
          <input
            value={email}
            disabled
            className="w-full cursor-not-allowed rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3.5 py-2.5 opacity-70"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-[13px]">
            <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
              CURRENT PASSWORD
            </span>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3.5 py-2.5 outline-none focus:border-[var(--a1)]"
            />
          </label>
          <label className="block text-[13px]">
            <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
              NEW PASSWORD
            </span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3.5 py-2.5 outline-none focus:border-[var(--a1)]"
            />
          </label>
        </div>

        {message && <p className="text-sm text-[var(--a1)]">{message}</p>}
        {error && <p className="text-sm text-rose-400">{error}</p>}

        <button type="submit" disabled={saving} className="btn-primary self-start">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <div className="flex items-center justify-between gap-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-[22px]">
        <div>
          <h3 className="text-base font-semibold tracking-[-0.02em]">Appearance</h3>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">
            Current theme: <span className="capitalize">{theme}</span>
          </p>
        </div>
        <ThemeToggle />
      </div>
    </div>
  );
}
