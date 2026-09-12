'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { LifeBuoy } from 'lucide-react';

type Ticket = {
  id: string;
  subject: string;
  status: string;
  updatedAt: string;
  user: { id: string; email: string; name: string | null };
  messages?: { body: string }[];
  _count?: { messages: number };
};

export default function AdminTicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [status, setStatus] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [reply, setReply] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/tickets?status=${status}`);
      if (res.ok) {
        const data = await res.json();
        setTickets(data.tickets || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [status]);

  const openTicket = async (id: string) => {
    setActiveId(id);
    const res = await fetch(`/api/tickets/${id}`);
    if (res.ok) {
      const data = await res.json();
      setDetail(data.ticket);
    }
  };

  const sendReply = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeId || !reply.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/tickets/${activeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: reply.trim() }),
      });
      setReply('');
      await openTicket(activeId);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const setTicketStatus = async (next: string) => {
    if (!activeId) return;
    await fetch(`/api/tickets/${activeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    await openTicket(activeId);
    await load();
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-center gap-2 text-[13px] text-[var(--ink3)]">
        <LifeBuoy className="h-4 w-4 text-[var(--a1)]" />
        User support tickets (separate from Contact messages)
      </p>

      <div className="flex flex-wrap gap-1.5">
        {['ALL', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-[10px] px-3 py-1.5 text-xs font-semibold ${
              status === s ? 'bg-[var(--a1soft)] text-[var(--a1)]' : 'text-[var(--ink3)] hover:bg-[var(--bg2)]'
            }`}
          >
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--card)]">
          {loading ? (
            <p className="p-6 text-sm text-[var(--ink3)]">Loading…</p>
          ) : tickets.length === 0 ? (
            <p className="p-6 text-sm text-[var(--ink3)]">No tickets.</p>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto divide-y divide-[var(--line)]">
              {tickets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openTicket(t.id)}
                  className={`flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-[var(--bg2)] ${
                    activeId === t.id ? 'bg-[var(--bg2)]' : ''
                  }`}
                >
                  <div className="flex justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{t.subject}</span>
                    <span className="font-mono text-[10px] text-[var(--ink3)]">{t.status}</span>
                  </div>
                  <span className="truncate font-mono text-[11px] text-[var(--ink3)]">
                    {t.user.email}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-4">
          {!detail ? (
            <p className="text-sm text-[var(--ink3)]">Select a ticket.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{detail.subject}</h3>
                  <p className="font-mono text-[11px] text-[var(--ink3)]">{detail.user?.email}</p>
                  <Link href={`/admin/users/${detail.user?.id}`} className="text-[12px] text-[var(--a1)] hover:underline">
                    Open user
                  </Link>
                </div>
                <select
                  value={detail.status}
                  onChange={(e) => setTicketStatus(e.target.value)}
                  className="rounded-[10px] border border-[var(--line)] bg-[var(--bg2)] px-2 py-1.5 text-xs"
                >
                  {['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
                {detail.messages?.map((m: any) => (
                  <div
                    key={m.id}
                    className={`rounded-[10px] border px-3 py-2 text-sm ${
                      m.isStaff ? 'border-[var(--a1)]/30 bg-[var(--a1soft)]' : 'border-[var(--line)] bg-[var(--bg2)]'
                    }`}
                  >
                    <p className="mb-1 font-mono text-[9px] text-[var(--ink3)]">
                      {m.isStaff ? 'STAFF' : 'USER'} · {new Date(m.createdAt).toLocaleString()}
                    </p>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                  </div>
                ))}
              </div>

              <form onSubmit={sendReply} className="flex flex-col gap-2">
                <textarea
                  rows={3}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Staff reply…"
                  className="rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm outline-none focus:border-[var(--a1)]"
                />
                <button type="submit" disabled={saving || !reply.trim()} className="btn-primary w-fit !text-[13px]">
                  {saving ? 'Sending…' : 'Send reply'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
