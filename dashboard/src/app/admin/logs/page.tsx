'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { flowFetch } from '@/lib/flowApi';
import { formatLogDetails } from '@/lib/adminLogFormat';
import { AdminTablePager } from '@/components/AdminTablePager';

const PAGE_SIZE = 20;

type LogRow = {
  id?: string;
  role?: string;
  username?: string;
  action?: string;
  details?: Record<string, unknown>;
  createdAt?: string;
  timestamp?: string;
};

function actionBadgeClass(action?: string) {
  if (action === 'client_login') return 'bg-emerald-500/15 text-emerald-400';
  if (
    action === 'suspicious_login' ||
    action === 'ban_user' ||
    action === 'device_ban_match' ||
    action === 'cascade_ban_device'
  ) {
    return 'bg-rose-500/15 text-rose-400';
  }
  if (action === 'login_failed') return 'bg-amber-500/15 text-amber-400';
  if (action === 'switch_server') return 'bg-sky-500/15 text-sky-400';
  return 'bg-[var(--bg2)] text-[var(--ink2)]';
}

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [page, setPage] = useState(1);
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
      setPage(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const pageRows = logs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-[var(--ink3)]">
          Auth, credits, Device ID / IP / country, and admin actions
        </p>
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
              <th className="px-4 py-3">IP / Country / Device / Client</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-[var(--ink3)]">
                  Loading…
                </td>
              </tr>
            ) : pageRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-[var(--ink3)]">
                  No logs
                </td>
              </tr>
            ) : (
              pageRows.map((log, i) => (
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
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-md px-2 py-0.5 font-mono text-[11px] ${actionBadgeClass(log.action)}`}
                    >
                      {log.action || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-[var(--ink2)] break-all">
                    {formatLogDetails(log.details) || '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <AdminTablePager
        page={page}
        pageSize={PAGE_SIZE}
        total={logs.length}
        onPageChange={setPage}
      />
    </div>
  );
}
