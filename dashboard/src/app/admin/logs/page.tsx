'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { flowFetch } from '@/lib/flowApi';

type LogRow = {
  id?: string;
  role?: string;
  username?: string;
  action?: string;
  details?: Record<string, unknown>;
  createdAt?: string;
  timestamp?: string;
};

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await flowFetch('/api/admin/logs');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load logs');
      setLogs(data.logs || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-[var(--ink3)]">Auth, credits, and admin actions from Express</p>
        <button type="button" onClick={load} className="btn-secondary !px-3 !py-2 !text-xs">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>
      {error && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
          {error}
        </p>
      )}
      <div className="overflow-hidden rounded-2xl border border-[var(--line)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--bg2)] text-[11px] uppercase tracking-wider text-[var(--ink3)]">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Who</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-[var(--ink3)]">Loading…</td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-[var(--ink3)]">No logs</td>
              </tr>
            ) : (
              logs.map((log, i) => (
                <tr key={log.id || i} className="border-t border-[var(--line)] align-top">
                  <td className="px-4 py-3 whitespace-nowrap text-[12px] text-[var(--ink3)]">
                    {log.createdAt || log.timestamp
                      ? new Date(String(log.createdAt || log.timestamp)).toLocaleString()
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium">{log.username || '—'}</span>
                    <span className="ml-1 text-[11px] text-[var(--ink3)]">{log.role || ''}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px]">{log.action || '—'}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-[var(--ink2)] break-all">
                    {log.details ? JSON.stringify(log.details) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
