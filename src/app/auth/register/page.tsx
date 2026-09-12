'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, AlertCircle, Loader2, Sparkles, CheckCircle2 } from 'lucide-react';
import SiteBrand from '@/components/SiteBrand';
import ThemeToggle from '@/components/ThemeToggle';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col justify-center overflow-hidden bg-[var(--background)] px-4 py-12">
      <div
        className="pointer-events-none absolute left-1/2 top-1/4 h-80 w-80 -translate-x-1/2 rounded-full blur-[110px]"
        style={{ background: 'var(--hero-glow)' }}
      />
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="relative mx-auto w-full max-w-md text-center">
        <SiteBrand className="mb-6 justify-center" />
        <h2 className="font-display text-2xl font-bold text-[var(--fg)]">Create your account</h2>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">50 welcome credits included</p>
      </div>
      <div className="relative mx-auto mt-8 w-full max-w-md">
        <form onSubmit={handleSubmit} className="surface-card space-y-4 rounded-3xl p-8">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--accent-soft)] p-3.5 text-left text-xs text-[var(--fg)]">
            <div className="mb-2 flex items-center gap-2 font-semibold text-[var(--accent)]">
              <Sparkles className="h-3.5 w-3.5" />
              Welcome grant
            </div>
            <ul className="space-y-1 text-[var(--fg-muted)]">
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-[var(--accent)]" />
                30 Standard credits
              </li>
              <li className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-[var(--accent)]" />
                20 Pro credits
              </li>
            </ul>
          </div>
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          <label className="block text-sm">
            <span className="mb-1.5 block text-[var(--fg-muted)]">Name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 outline-none ring-[var(--accent)] focus:ring-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-[var(--fg-muted)]">Email</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 outline-none ring-[var(--accent)] focus:ring-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 block text-[var(--fg-muted)]">Password</span>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 outline-none ring-[var(--accent)] focus:ring-2"
            />
          </label>
          <button type="submit" disabled={loading} className="btn-primary w-full py-3">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-[var(--fg-muted)]">
          Already have an account?{' '}
          <Link href="/auth/login" className="font-semibold text-[var(--accent)]">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
