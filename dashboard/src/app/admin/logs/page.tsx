'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { flowFetch } from '@/lib/flowApi';

type LogRow = {
  id?: string;
  userId?: string | null;
  role?: string;
  username?: string | null;
  action?: string;
  country?: string | null;
  ip?: string | null;
  details?: Record<string, unknown>;
  createdAt?: string;
  timestamp?: string;
};

type FilterOpt = { id: string; label: string };

const inputClass =
  'rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--a1)]';

function formatWhen(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function detailPreview(details?: Record<string, unknown>) {
  if (!details || typeof details !== 'object') return '—';
  const copy = { ...details };
  delete copy.username;
  delete copy.action;
  const keys = Object.keys(copy);
  if (!keys.length) return '—';
  try {
    return JSON.stringify(copy);
  } catch {
    return '—';
  }
}

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [countries, setCountries] = useState<FilterOpt[]>([{ id: 'all', label: 'All' }]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [username, setUsername] = useState('');
  const [country, setCountry] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (username.trim()) params.set('username', username.trim());
      if (country && country !== 'all') params.set('country', country);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      params.set('limit', '400');
      const qs = params.toString();
      const res = await flowFetch(`/api/admin/logs${qs ? `?${qs}` : ''}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load logs');
      setLogs(data.logs || []);
      if (Array.isArray(data.filters?.countries) && data.filters.countries.length) {
        setCountries(data.filters.countries);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [q, username, country, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const usernames = useMemo(() => {
    const set = new Set<string>();
    for (const row of logs) {
      const u = String(row.username || '').trim();
      if (u) set.add(u);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [logs]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--ink3)]">
          All user activity — search, filter by user, country, and time range
        </p>
        <button type="button" onClick={load} className="btn-secondary !px-3 !py-2 !text-xs">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className={`${inputClass} min-w-[180px] flex-1`}
          placeholder="Search logs (action, IP, details…)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <input
          className={`${inputClass} w-[160px]`}
          list="activity-usernames"
          placeholder="Filter user…"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <datalist id="activity-usernames">
          {usernames.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
        <select
          className={`${inputClass} !w-auto min-w-[130px]`}
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        >
          {countries.map((c) => (
            <option key={c.id} value={c.id}>
              Country: {c.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[12px] text-[var(--ink3)]">
          From
          <input
            type="date"
            className={inputClass}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1 text-[12px] text-[var(--ink3)]">
          To
          <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn-secondary !px-3 !py-2 !text-xs"
          onClick={() => {
            setQ('');
            setUsername('');
            setCountry('all');
            setFrom('');
            setTo('');
          }}
        >
          Clear
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
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Country</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[var(--ink3)]">
                  Loading…
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[var(--ink3)]">
                  No logs match these filters
                </td>
              </tr>
            ) : (
              logs.map((log, i) => {
                const when = String(log.createdAt || log.timestamp || '');
                const c = String(log.country || (log.details?.country as string) || '').toUpperCase();
                return (
                  <tr key={log.id || i} className="border-t border-[var(--line)] align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-[12px] text-[var(--ink3)]">
                      {formatWhen(when)}
                    </td>
                    <td className="px-4 py-3">
                      {log.userId ? (
                        <Link
                          href={`/admin/users/${log.userId}`}
                          className="font-medium text-[var(--a1)] hover:underline"
                        >
                          {log.username || '—'}
                        </Link>
                      ) : (
                        <span className="font-medium">{log.username || '—'}</span>
                      )}
                      {log.ip ? (
                        <div className="font-mono text-[11px] text-[var(--ink3)]">{String(log.ip)}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px]">{c || '—'}</td>
                    <td className="px-4 py-3 font-mono text-[12px]">{log.action || '—'}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-[var(--ink2)] break-all">
                      {detailPreview(log.details)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {!loading && logs.length > 0 ? (
        <p className="text-[12px] text-[var(--ink3)]">{logs.length} event{logs.length === 1 ? '' : 's'}</p>
      ) : null}
    </div>
  );
}
