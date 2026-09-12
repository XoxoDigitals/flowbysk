'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

type Message = {
  id: string;
  body: string;
  isStaff: boolean;
  createdAt: string;
};

type Ticket = {
  id: string;
  subject: string;
  status: string;
  messages: Message[];
};

export default function DashboardTicketDetailPage() {
  const params = useParams();
  const id = String(params?.id || '');
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [reply, setReply] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const res = await fetch(`/api/tickets/${id}`);
    if (res.ok) {
      const data = await res.json();
      setTicket(data.ticket);
    }
  };

  useEffect(() => {
    if (id) load();
  }, [id]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: reply.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setReply('');
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!ticket) {
    return <p className="text-sm text-[var(--ink3)]">Loading ticket…</p>;
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Link href="/dashboard/support" className="flex items-center gap-1 text-[13px] text-[var(--ink3)] hover:text-[var(--a1)]">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to tickets
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-semibold tracking-[-0.02em]">{ticket.subject}</h3>
        <span className="rounded-md bg-[var(--bg2)] px-2 py-0.5 font-mono text-[10px]">{ticket.status}</span>
      </div>

      <div className="flex flex-col gap-3 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-4">
        {ticket.messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-[12px] border px-3.5 py-3 ${
              m.isStaff
                ? 'border-[var(--a1)]/30 bg-[var(--a1soft)]'
                : 'border-[var(--line)] bg-[var(--bg2)]'
            }`}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] font-semibold text-[var(--ink3)]">
                {m.isStaff ? 'SUPPORT' : 'YOU'}
              </span>
              <span className="font-mono text-[10px] text-[var(--ink3)]">
                {new Date(m.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
          </div>
        ))}
      </div>

      {ticket.status !== 'CLOSED' && (
        <form onSubmit={send} className="flex flex-col gap-2">
          <textarea
            rows={3}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write a reply…"
            className="rounded-[11px] border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm outline-none focus:border-[var(--a1)]"
          />
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button type="submit" disabled={saving || !reply.trim()} className="btn-primary w-fit">
            {saving ? 'Sending…' : 'Send reply'}
          </button>
        </form>
      )}
    </div>
  );
}
