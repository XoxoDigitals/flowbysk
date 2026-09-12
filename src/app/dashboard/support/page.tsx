'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LifeBuoy, Plus } from 'lucide-react';
import { useSiteSettings } from '@/components/SiteSettingsProvider';

type Ticket = {
  id: string;
  subject: string;
  status: string;
  updatedAt: string;
  _count?: { messages: number };
  messages?: { body: string }[];
};

export default function DashboardSupportPage() {
  const router = useRouter();
  const { ticketSystemEnabled } = useSiteSettings();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const res = await fetch('/api/tickets');
      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ticketSystemEnabled === false) router.replace('/dashboard');
  }, [ticketSystemEnabled, router]);

  useEffect(() => {
    load();
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setShowNew(false);
      setSubject('');
      setMessage('');
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[13px] text-[var(--ink3)]">
          <LifeBuoy className="h-4 w-4 text-[var(--a1)]" />
          Open a ticket for account, billing, or generation help
        </p>
        <button type="button" className="btn-primary !text-[13px]" onClick={() => setShowNew(true)}>
          <Plus className="h-3.5 w-3.5" />
          New ticket
        </button>
      </div>

      {showNew && (
        <form onSubmit={create} className="flex flex-col gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-5">
          <h3 className="text-base font-semibold">New support ticket</h3>
          <input
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm outline-none focus:border-[var(--a1)]"
          />
          <textarea
            required
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe your issue…"
            className="rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm outline-none focus:border-[var(--a1)]"
          />
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setShowNew(false)}>
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Sending…' : 'Submit ticket'}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--card)]">
        {loading ? (
          <p className="p-6 text-sm text-[var(--ink3)]">Loading…</p>
        ) : tickets.length === 0 ? (
          <p className="p-6 text-sm text-[var(--ink3)]">No tickets yet.</p>
        ) : (
          <div className="divide-y divide-[var(--line)]">
            {tickets.map((t) => (
              <Link
                key={t.id}
                href={`/dashboard/support/${t.id}`}
                className="flex flex-col gap-1 px-4 py-3.5 hover:bg-[var(--bg2)] sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{t.subject}</p>
                  <p className="truncate text-[12px] text-[var(--ink3)]">
                    {t.messages?.[0]?.body || `${t._count?.messages || 0} messages`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-md bg-[var(--bg2)] px-2 py-0.5 font-mono text-[10px] text-[var(--ink2)]">
                    {t.status}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--ink3)]">
                    {new Date(t.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
