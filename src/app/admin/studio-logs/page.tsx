'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  RefreshCw,
  Search,
  Terminal,
  Trash2,
  ChevronDown,
  ChevronRight,
  Filter,
  Calendar,
  Pause,
  Play,
  XCircle,
  RotateCcw,
} from 'lucide-react';

interface StudioLogItem {
  id: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  message: string;
  source: string;
  details: any;
  runId?: string | null;
  userId: string | null;
  userEmail: string | null;
  flowEmail: string | null;
  createdAt: string;
  user?: { id: string; email: string; name: string | null } | null;
}

interface StudioRun {
  id: string;
  runId: string | null;
  title: string;
  status: 'QUEUED' | 'GENERATING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'WARN' | 'INFO';
  startedAt: string;
  updatedAt: string;
  durationMs?: number;
  durationSec?: number;
  userId: string | null;
  userEmail: string | null;
  flowEmail: string | null;
  eventCount: number;
  events: StudioLogItem[];
}

const inputClass =
  'rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-1.5 text-xs text-[var(--ink)] placeholder:text-[var(--ink3)] outline-none focus:border-[var(--a1)]';

function statusClass(status: string) {
  if (status === 'FAILED') return 'bg-rose-500/15 text-rose-500';
  if (status === 'CANCELLED') return 'bg-slate-500/15 text-slate-400';
  if (status === 'COMPLETED') return 'bg-emerald-500/15 text-emerald-600';
  if (status === 'GENERATING') return 'bg-sky-500/15 text-sky-600';
  if (status === 'QUEUED') return 'bg-amber-500/15 text-amber-600';
  if (status === 'WARN') return 'bg-[var(--a2soft)] text-[var(--a2)]';
  return 'bg-[var(--a1soft)] text-[var(--a1)]';
}

function levelClass(level: string) {
  if (level === 'ERROR') return 'bg-rose-500/15 text-rose-500';
  if (level === 'WARN') return 'bg-[var(--a2soft)] text-[var(--a2)]';
  if (level === 'DEBUG') return 'bg-[var(--bg3)] text-[var(--ink3)]';
  return 'bg-[var(--a1soft)] text-[var(--a1)]';
}

function formatTs(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultFrom() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return toLocalInputValue(d);
}

function defaultTo() {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return toLocalInputValue(d);
}

export default function AdminStudioLogsPage() {
  const [runs, setRuns] = useState<StudioRun[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [runCount, setRunCount] = useState(0);
  const [level, setLevel] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [source, setSource] = useState('ALL');
  const [userFilter, setUserFilter] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [queuePaused, setQueuePaused] = useState(false);
  const [actionBusy, setActionBusy] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (level !== 'ALL') params.set('level', level);
      if (source !== 'ALL') params.set('source', source);
      if (userFilter.trim()) params.set('user', userFilter.trim());
      if (search.trim()) params.set('q', search.trim());
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(to).toISOString());
      params.set('group', '1');
      params.set('limit', '400');

      const res = await fetch(`/api/admin/studio-logs?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs || []);
        setTotal(data.total || 0);
        setRunCount(data.runCount || (data.runs || []).length);
        setSources(data.sources || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [level, source, userFilter, search, from, to]);

  useEffect(() => {
    setLoading(true);
    fetchLogs();
    const t = setInterval(fetchLogs, 4000);
    return () => clearInterval(t);
  }, [fetchLogs]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/studio-controls');
        if (res.ok) {
          const data = await res.json();
          setQueuePaused(!!data.queue?.paused);
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const runAction = async (action: string, extra?: Record<string, unknown>) => {
    setActionBusy(action);
    setActionMsg('');
    try {
      const res = await fetch('/api/admin/studio-logs/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Action failed');
      if (typeof data.queue?.paused === 'boolean') setQueuePaused(data.queue.paused);
      setActionMsg(data.message || `${action} ok`);
      await fetchLogs();
    } catch (err: any) {
      setActionMsg(err.message || 'Action failed');
    } finally {
      setActionBusy('');
    }
  };

  const visibleRuns = useMemo(() => {
    if (statusFilter === 'ALL') return runs;
    return runs.filter((r) => r.status === statusFilter);
  }, [runs, statusFilter]);

  const clearLogs = async () => {
    if (!confirm('Clear all Studio Logs from the database? This cannot be undone.')) return;
    setClearing(true);
    try {
      const res = await fetch('/api/admin/studio-logs', { method: 'DELETE' });
      if (res.ok) await fetchLogs();
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ink)]">Studio Logs</h2>
          <p className="mt-0.5 text-xs text-[var(--ink3)]">
            One row per generation · expand for live event flow · {runCount} runs · {total} events
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!!actionBusy}
            onClick={() => runAction(queuePaused ? 'start_queue' : 'pause_queue')}
            className={`inline-flex items-center gap-1.5 rounded-[11px] border px-3 py-1.5 text-xs font-medium ${
              queuePaused
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-600'
            }`}
            title={queuePaused ? 'Resume dispatching IN_QUEUE jobs' : 'Stop starting new pending jobs'}
          >
            {queuePaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {queuePaused ? 'Start Queue Pending' : 'Stop Queue Pending'}
          </button>
          <button
            type="button"
            disabled={!!actionBusy}
            onClick={() => {
              if (confirm('Cancel all currently generating jobs?')) runAction('cancel_generating');
            }}
            className="inline-flex items-center gap-1.5 rounded-[11px] border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-500"
          >
            <XCircle className="h-3.5 w-3.5" />
            Cancel Generating
          </button>
          <button
            type="button"
            disabled={!!actionBusy}
            onClick={() => {
              if (confirm('Retry recent failed prompts?')) runAction('retry_failed');
            }}
            className="inline-flex items-center gap-1.5 rounded-[11px] border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-600"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Retry Failed Prompts
          </button>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchLogs();
            }}
            className="inline-flex items-center gap-1.5 rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] hover:bg-[var(--bg3)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={clearLogs}
            disabled={clearing}
            className="inline-flex items-center gap-1.5 rounded-[11px] border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-500/20 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear all
          </button>
        </div>
      </div>

      {actionMsg ? (
        <p className="text-xs text-[var(--ink2)]">
          {actionBusy ? `${actionBusy}… ` : ''}
          {actionMsg}
          {queuePaused ? ' · Queue is PAUSED' : ''}
        </p>
      ) : queuePaused ? (
        <p className="text-xs text-amber-600">Queue is paused — pending jobs will not start until you Start Queue.</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-[var(--line)] bg-[var(--bg)] p-3">
        <Filter className="h-3.5 w-3.5 text-[var(--ink3)]" />
        <select className={inputClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="ALL">All statuses</option>
          <option value="QUEUED">Queued</option>
          <option value="GENERATING">Generating</option>
          <option value="COMPLETED">Completed</option>
          <option value="FAILED">Failed</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="WARN">Warn</option>
          <option value="INFO">Info</option>
        </select>
        <select className={inputClass} value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="ALL">All levels</option>
          <option value="INFO">Info</option>
          <option value="WARN">Warn</option>
          <option value="ERROR">Error</option>
          <option value="DEBUG">Debug</option>
        </select>
        <select className={inputClass} value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="ALL">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="relative inline-flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5 text-[var(--ink3)]" />
          <input
            type="datetime-local"
            className={inputClass}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            title="From"
          />
          <span className="text-[10px] text-[var(--ink3)]">to</span>
          <input
            type="datetime-local"
            className={inputClass}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            title="To"
          />
        </div>
        <div className="relative min-w-[160px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink3)]" />
          <input
            className={`${inputClass} w-full pl-8`}
            placeholder="User email / id / Flow account"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
          />
        </div>
        <div className="relative min-w-[160px] flex-1">
          <Terminal className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink3)]" />
          <input
            className={`${inputClass} w-full pl-8`}
            placeholder="Search prompt / message…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--bg)]">
        {loading && visibleRuns.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-[var(--ink3)]">Loading studio logs…</div>
        ) : visibleRuns.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-[var(--ink3)]">No generation runs match these filters.</div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {visibleRuns.map((run) => {
              const open = expandedId === run.id;
              const googleAccount = run.flowEmail || null;
              const saasUser = run.userEmail || null;
              return (
                <li key={run.id} className="px-3 py-2.5 hover:bg-[var(--bg2)]/60">
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 text-left"
                    onClick={() => setExpandedId(open ? null : run.id)}
                  >
                    {open ? (
                      <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" />
                    ) : (
                      <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" />
                    )}
                    <span className="w-[140px] shrink-0 font-mono text-[10px] text-[var(--ink3)]">
                      {formatTs(run.updatedAt)}
                    </span>
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusClass(run.status)}`}
                    >
                      {run.status}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--ink)]">
                      {run.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-[var(--ink3)]">{run.eventCount} events</span>
                    {typeof run.durationSec === 'number' && run.durationSec > 0 ? (
                      <span
                        className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                          run.status === 'COMPLETED'
                            ? 'bg-emerald-500/15 text-emerald-600'
                            : 'bg-[var(--bg3)] text-[var(--ink2)]'
                        }`}
                        title="Generation duration"
                      >
                        {run.durationSec}s
                      </span>
                    ) : null}
                    <span className="flex max-w-[220px] shrink-0 flex-col items-end gap-0.5 text-right">
                      {googleAccount ? (
                        <span
                          className="truncate text-[10px] font-medium text-[var(--a1)]"
                          title="Google Flow account"
                        >
                          {googleAccount}
                        </span>
                      ) : (
                        <span className="text-[10px] text-[var(--ink3)]">Google: —</span>
                      )}
                      {saasUser ? (
                        run.userId ? (
                          <Link
                            href={`/admin/users/${run.userId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="truncate text-[10px] text-[var(--ink3)] hover:text-[var(--a1)] hover:underline"
                            title="Studio user"
                          >
                            {saasUser}
                          </Link>
                        ) : (
                          <span className="truncate text-[10px] text-[var(--ink3)]" title="Studio user">
                            {saasUser}
                          </span>
                        )
                      ) : null}
                    </span>
                  </button>

                  {open && (
                    <div className="mt-2 ml-5 space-y-2 rounded-[10px] border border-[var(--line)] bg-[var(--bg2)] p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {(run.status === 'QUEUED' || run.status === 'GENERATING') && (
                          <>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] font-medium text-rose-500"
                              onClick={(e) => {
                                e.stopPropagation();
                                runAction('cancel', { runId: run.runId || undefined, jobId: run.runId ? undefined : run.id });
                              }}
                            >
                              <XCircle className="h-3 w-3" />
                              Cancel / Stop
                            </button>
                            {run.status === 'GENERATING' && (
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[10px] font-medium text-sky-600"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  runAction('retry', { runId: run.runId || undefined, jobId: run.runId ? undefined : run.id });
                                }}
                              >
                                <RotateCcw className="h-3 w-3" />
                                Retry Generating
                              </button>
                            )}
                          </>
                        )}
                        {(run.status === 'FAILED' || run.status === 'CANCELLED') && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[10px] font-medium text-sky-600"
                            onClick={(e) => {
                              e.stopPropagation();
                              runAction('retry', { runId: run.runId || undefined, jobId: run.runId ? undefined : run.id });
                            }}
                          >
                            <RotateCcw className="h-3 w-3" />
                            Retry Failed
                          </button>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-[var(--ink3)]">
                        runId: {run.runId || 'heuristic'} · started {formatTs(run.startedAt)} · updated{' '}
                        {formatTs(run.updatedAt)}
                        {typeof run.durationSec === 'number' && run.durationSec > 0
                          ? ` · ${run.durationSec}s`
                          : ''}
                        {googleAccount ? ` · Google ${googleAccount}` : ''}
                        {saasUser ? ` · user ${saasUser}` : ''}
                      </div>
                      <ol className="space-y-1.5 border-l border-[var(--line)] pl-3">
                        {run.events.map((ev) => (
                          <li key={ev.id} className="relative text-xs">
                            <span className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-[var(--a1)]" />
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[10px] text-[var(--ink3)]">
                                {formatTs(ev.createdAt)}
                              </span>
                              <span
                                className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${levelClass(ev.level)}`}
                              >
                                {ev.level}
                              </span>
                              <span className="rounded-md bg-[var(--bg3)] px-1.5 py-0.5 font-mono text-[10px]">
                                {ev.source}
                              </span>
                              <span className="text-[var(--ink)]">{ev.message}</span>
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
