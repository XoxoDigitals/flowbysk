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

type LoginEvent = {
  at?: string;
  action?: string;
  label?: string;
  stage?: string;
  outcome?: string;
  lockedUntil?: string | null;
  deviceId?: string | null;
  client?: string | null;
};

type LoginSession = {
  attemptId: string;
  userId?: string | null;
  username?: string | null;
  startedAt?: string;
  finishedAt?: string | null;
  outcome?: string;
  ip?: string | null;
  country?: string | null;
  serverName?: string | null;
  deviceId?: string | null;
  clientLoginAt?: string | null;
  lockedUntil?: string | null;
  durationMs?: number | null;
  totalSteps?: number;
  stepCounts?: { email?: number; password?: number; otp?: number; other?: number };
  events?: LoginEvent[];
};

const inputClass =
  'rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--a1)]';

function formatWhen(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatDuration(ms?: number | null) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function outcomeBadge(outcome?: string) {
  const o = String(outcome || 'unknown').toLowerCase();
  if (o === 'success') return 'bg-emerald-500/15 text-emerald-400';
  if (o === 'in_progress' || o === 'api_login_only') return 'bg-amber-500/15 text-amber-400';
  if (o === 'cancelled' || o === 'failed') return 'bg-rose-500/15 text-rose-400';
  return 'bg-[var(--bg2)] text-[var(--ink3)]';
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
  const [tab, setTab] = useState<'timeline' | 'all'>('timeline');
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [sessions, setSessions] = useState<LoginSession[]>([]);
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
      if (username.trim()) params.set('username', username.trim());
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      params.set('limit', tab === 'timeline' ? '100' : '400');

      if (tab === 'timeline') {
        const qs = params.toString();
        const res = await flowFetch(`/api/admin/logs/login-sessions${qs ? `?${qs}` : ''}`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load login sessions');
        setSessions(data.sessions || []);
      } else {
        if (q.trim()) params.set('q', q.trim());
        if (country && country !== 'all') params.set('country', country);
        const qs = params.toString();
        const res = await flowFetch(`/api/admin/logs${qs ? `?${qs}` : ''}`);
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load logs');
        setLogs(data.logs || []);
        if (Array.isArray(data.filters?.countries) && data.filters.countries.length) {
          setCountries(data.filters.countries);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [tab, q, username, country, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const usernames = useMemo(() => {
    const set = new Set<string>();
    for (const row of logs) {
      const u = String(row.username || '').trim();
      if (u) set.add(u);
    }
    for (const s of sessions) {
      const u = String(s.username || '').trim();
      if (u) set.add(u);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [logs, sessions]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--ink3)]">
          Login timelines show start → credential steps → success/fail. Flat log is every event.
        </p>
        <button type="button" onClick={load} className="btn-secondary !px-3 !py-2 !text-xs">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`!px-3 !py-2 !text-xs rounded-[11px] border ${
            tab === 'timeline'
              ? 'border-[var(--a1)] bg-[var(--a1)]/10 text-[var(--ink)]'
              : 'border-[var(--line)] text-[var(--ink3)]'
          }`}
          onClick={() => setTab('timeline')}
        >
          Login timeline
        </button>
        <button
          type="button"
          className={`!px-3 !py-2 !text-xs rounded-[11px] border ${
            tab === 'all'
              ? 'border-[var(--a1)] bg-[var(--a1)]/10 text-[var(--ink)]'
              : 'border-[var(--line)] text-[var(--ink3)]'
          }`}
          onClick={() => setTab('all')}
        >
          All events
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {tab === 'all' ? (
          <input
            className={`${inputClass} min-w-[180px] flex-1`}
            placeholder="Search logs (action, IP, details…)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        ) : null}
        <input
          className={`${inputClass} w-[200px]`}
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
        {tab === 'all' ? (
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
        ) : null}
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

      {tab === 'timeline' ? (
        <div className="flex flex-col gap-4">
          {loading ? (
            <p className="text-sm text-[var(--ink3)]">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-[var(--ink3)]">No login sessions match these filters</p>
          ) : (
            sessions.map((s) => (
              <div
                key={s.attemptId}
                className="rounded-2xl border border-[var(--line)] bg-[var(--bg)] px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    {s.userId ? (
                      <Link
                        href={`/admin/users/${s.userId}`}
                        className="font-medium text-[var(--a1)] hover:underline"
                      >
                        {s.username || '—'}
                      </Link>
                    ) : (
                      <span className="font-medium">{s.username || '—'}</span>
                    )}
                    <div className="mt-1 text-[12px] text-[var(--ink3)]">
                      {formatWhen(s.startedAt)}
                      {s.finishedAt ? ` → ${formatWhen(s.finishedAt)}` : ''}
                      {' · '}
                      {formatDuration(s.durationMs)}
                      {s.serverName ? ` · ${s.serverName}` : ''}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-[var(--ink3)]">
                      {[s.ip, s.country, s.deviceId ? `device ${s.deviceId}` : null]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide ${outcomeBadge(
                      s.outcome
                    )}`}
                  >
                    {s.outcome || 'unknown'}
                  </span>
                </div>

                <div className="mt-3 text-[12px] text-[var(--ink2)]">
                  Steps: email {s.stepCounts?.email || 0} · password {s.stepCounts?.password || 0} ·
                  otp {s.stepCounts?.otp || 0}
                  {s.lockedUntil ? ` · lock until ${formatWhen(s.lockedUntil)}` : ''}
                </div>

                <ol className="mt-4 space-y-2 border-l border-[var(--line)] pl-4">
                  {(s.events || []).map((ev, i) => (
                    <li key={`${s.attemptId}-${i}`} className="relative text-sm">
                      <span className="absolute -left-[1.15rem] top-1.5 h-2 w-2 rounded-full bg-[var(--a1)]" />
                      <div className="text-[11px] text-[var(--ink3)]">{formatWhen(ev.at)}</div>
                      <div className="text-[var(--ink)]">{ev.label || ev.action}</div>
                    </li>
                  ))}
                </ol>
              </div>
            ))
          )}
          {!loading && sessions.length > 0 ? (
            <p className="text-[12px] text-[var(--ink3)]">
              {sessions.length} session{sessions.length === 1 ? '' : 's'}
            </p>
          ) : null}
        </div>
      ) : (
        <>
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
                    const c = String(
                      log.country || (log.details?.country as string) || ''
                    ).toUpperCase();
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
                            <div className="font-mono text-[11px] text-[var(--ink3)]">
                              {String(log.ip)}
                            </div>
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
            <p className="text-[12px] text-[var(--ink3)]">
              {logs.length} event{logs.length === 1 ? '' : 's'}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
