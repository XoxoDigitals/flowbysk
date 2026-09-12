'use client';

import { useEffect, useState } from 'react';
import { Mail, Archive, Eye } from 'lucide-react';

type Msg = {
  id: string;
  name: string;
  email: string;
  subject: string | null;
  message: string;
  status: string;
  createdAt: string;
};

export default function AdminMessagesPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [status, setStatus] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Msg | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/messages?status=${status}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [status]);

  const setMsgStatus = async (id: string, next: string) => {
    await fetch('/api/admin/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: next }),
    });
    await load();
    if (selected?.id === id) setSelected({ ...selected, status: next });
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-center gap-2 text-[13px] text-[var(--ink3)]">
        <Mail className="h-4 w-4 text-[var(--a1)]" />
        Homepage / Contact form submissions (one-way inbox)
      </p>

      <div className="flex flex-wrap gap-1.5">
        {['ALL', 'NEW', 'READ', 'ARCHIVED'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-[10px] px-3 py-1.5 text-xs font-semibold ${
              status === s ? 'bg-[var(--a1soft)] text-[var(--a1)]' : 'text-[var(--ink3)] hover:bg-[var(--bg2)]'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--card)]">
          {loading ? (
            <p className="p-6 text-sm text-[var(--ink3)]">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="p-6 text-sm text-[var(--ink3)]">No messages.</p>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto">
              {messages.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSelected(m);
                    if (m.status === 'NEW') setMsgStatus(m.id, 'READ');
                  }}
                  className={`flex w-full flex-col gap-1 border-t border-[var(--line)] px-4 py-3 text-left first:border-t-0 hover:bg-[var(--bg2)] ${
                    selected?.id === m.id ? 'bg-[var(--bg2)]' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{m.name}</span>
                    <span className="font-mono text-[10px] text-[var(--ink3)]">{m.status}</span>
                  </div>
                  <span className="truncate font-mono text-[11px] text-[var(--ink3)]">{m.email}</span>
                  <span className="truncate text-[12px] text-[var(--ink2)]">
                    {m.subject || m.message}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-5">
          {!selected ? (
            <p className="text-sm text-[var(--ink3)]">Select a message to read.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold">{selected.subject || 'No subject'}</h3>
                  <p className="mt-1 text-sm text-[var(--ink2)]">
                    {selected.name} · <span className="font-mono text-[12px]">{selected.email}</span>
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-[var(--ink3)]">
                    {new Date(selected.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary !px-2.5 !py-1.5 !text-[11px]" onClick={() => setMsgStatus(selected.id, 'READ')}>
                    <Eye className="h-3.5 w-3.5" /> Read
                  </button>
                  <button type="button" className="btn-secondary !px-2.5 !py-1.5 !text-[11px]" onClick={() => setMsgStatus(selected.id, 'ARCHIVED')}>
                    <Archive className="h-3.5 w-3.5" /> Archive
                  </button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink)]">{selected.message}</p>
              <a href={`mailto:${selected.email}?subject=Re: ${encodeURIComponent(selected.subject || 'Your message')}`} className="btn-primary w-fit !text-[13px]">
                Reply by email
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
