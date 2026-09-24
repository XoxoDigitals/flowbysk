'use client';

import { useEffect, useState } from 'react';
import { flowFetch, readSession } from '@/lib/flowApi';
import { useRouter } from 'next/navigation';

type Me = {
  username: string;
  credits: number;
  planExpiry: string;
  plan?: string;
  isActive: boolean;
};

type LogItem = {
  id: string;
  action: string;
  timestamp: string;
  details?: Record<string, unknown>;
};

export default function BillingPage() {
  const router = useRouter();
  const [user, setUser] = useState<Me | null>(null);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!readSession()?.token) {
      router.push('/auth/login');
      return;
    }
    Promise.all([
      flowFetch('/api/v2/client/me').then((r) => (r.ok ? r.json() : null)),
      flowFetch('/api/v2/client/activity').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([me, activity]) => {
        if (me?.user) setUser(me.user);
        if (activity?.logs) setLogs(activity.logs);
      })
      .finally(() => setLoading(false));
  }, [router]);

  const expiry = user?.planExpiry ? new Date(user.planExpiry) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3.5 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">PLAN</span>
          <div className="mt-2 text-[28px] font-semibold tracking-[-0.03em]">
            {loading ? '…' : user?.plan || 'Standard'}
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">CREDITS</span>
          <div className="mt-2 text-[28px] font-semibold tracking-[-0.03em]">
            {loading ? '…' : (user?.credits ?? 0).toLocaleString()}
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">EXPIRES</span>
          <div className="mt-2 text-[28px] font-semibold tracking-[-0.03em]">
            {expiry ? expiry.toLocaleDateString() : '—'}
          </div>
        </div>
      </div>

      <div className="rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-5">
        <h3 className="text-base font-semibold">Credit &amp; account activity</h3>
        <p className="mt-1 text-[13px] text-[var(--ink3)]">
          Contact your admin or reseller to renew credits or extend your plan.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {logs.length === 0 && !loading && (
            <p className="text-sm text-[var(--ink3)]">No recent activity.</p>
          )}
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex items-center justify-between gap-3 rounded-[12px] border border-[var(--line)] px-3.5 py-2.5 text-sm"
            >
              <span className="font-medium">{log.action}</span>
              <span className="text-[12px] text-[var(--ink3)]">
                {new Date(log.timestamp).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
