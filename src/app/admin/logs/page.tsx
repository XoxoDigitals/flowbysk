'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw,
  Search,
  Trash2,
  Terminal,
  ShieldAlert,
  FileText,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

type ServiceTab = 'web' | 'bib' | 'api';

type LogLine = { file: string; stream: string; text: string };
type ArchiveItem = {
  name: string;
  path: string;
  size: number;
  mtime: string;
  service: string;
};

const TABS: { id: ServiceTab; label: string; hint: string }[] = [
  { id: 'web', label: 'Web', hint: 'flowbysk-web (Next)' },
  { id: 'bib', label: 'BiB', hint: 'flowbysk-bib' },
  { id: 'api', label: 'API', hint: 'flowbysk-api' },
];

const inputClass =
  'rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-1.5 text-xs text-[var(--ink)] placeholder:text-[var(--ink3)] outline-none focus:border-[var(--a1)]';

function streamBadge(stream: string) {
  if (stream === 'error') return 'bg-rose-500/15 text-rose-500';
  if (stream === 'out') return 'bg-[var(--a1soft)] text-[var(--a1)]';
  return 'bg-[var(--bg3)] text-[var(--ink3)]';
}

export default function AdminPm2LogsPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<ServiceTab>('web');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<LogLine[]>([]);
  const [files, setFiles] = useState<{ name: string; stream: string; size: number; mtime: string }[]>(
    []
  );
  const [archives, setArchives] = useState<ArchiveItem[]>([]);
  const [historyName, setHistoryName] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json().catch(() => ({}));
        const role = data?.user?.role || data?.role || '';
        setAllowed(role === 'SUPER_ADMIN');
      } catch {
        setAllowed(false);
      }
    })();
  }, []);

  const fetchLogs = useCallback(async () => {
    if (allowed !== true) return;
    try {
      const params = new URLSearchParams();
      params.set('service', tab);
      params.set('lines', '1000');
      if (q.trim()) params.set('q', q.trim());
      if (historyName) params.set('history', historyName);

      const res = await fetch(`/api/admin/pm2-logs?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load logs');

      if (data.mode === 'history' && data.history) {
        setLines(
          (data.history.lines || []).map((text: string) => ({
            file: data.history.name,
            stream: 'archive',
            text,
          }))
        );
        setFiles([]);
      } else {
        setLines(data.lines || []);
        setFiles(data.files || []);
      }
      setArchives(data.archives || []);
      setErr('');
    } catch (e: any) {
      setErr(e.message || 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, [allowed, tab, q, historyName]);

  useEffect(() => {
    if (allowed !== true) return;
    setLoading(true);
    fetchLogs();
  }, [allowed, fetchLogs]);

  useEffect(() => {
    if (allowed !== true || !autoRefresh || historyName) return;
    const t = setInterval(fetchLogs, 4000);
    return () => clearInterval(t);
  }, [allowed, autoRefresh, historyName, fetchLogs]);

  const clearLogs = async (scope: 'current' | 'all') => {
    const label = scope === 'all' ? 'ALL services (web + bib + api)' : `current tab (${tab})`;
    if (
      !confirm(
        `Clear ${label} PM2 logs AND delete History archives for this scope?\nThis cannot be undone.`
      )
    ) {
      return;
    }
    setClearing(true);
    setMsg('');
    setErr('');
    try {
      const params = new URLSearchParams();
      params.set('service', scope === 'all' ? 'all' : tab);
      const res = await fetch(`/api/admin/pm2-logs?${params.toString()}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Clear failed');
      setMsg(data.message || 'Cleared');
      setHistoryName(null);
      setArchives([]);
      await fetchLogs();
    } catch (e: any) {
      setErr(e.message || 'Clear failed');
    } finally {
      setClearing(false);
    }
  };

  if (allowed === null) {
    return (
      <div className="p-6 text-sm text-[var(--ink3)]">Checking access…</div>
    );
  }

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg space-y-3 rounded-[16px] border border-rose-500/30 bg-rose-500/10 p-6">
        <div className="flex items-center gap-2 text-rose-500">
          <ShieldAlert className="h-5 w-5" />
          <h2 className="text-sm font-semibold">Super Admin only</h2>
        </div>
        <p className="text-xs text-[var(--ink2)]">
          PM2 process logs (Web / BiB / API) are restricted to SUPER_ADMIN accounts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ink)]">PM2 Logs</h2>
          <p className="mt-0.5 text-xs text-[var(--ink3)]">
            Live process output · history archives · search · clear
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--ink3)]">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              disabled={!!historyName}
            />
            Auto-refresh
          </label>
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
            disabled={clearing}
            onClick={() => clearLogs('current')}
            className="inline-flex items-center gap-1.5 rounded-[11px] border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-500 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {clearing ? 'Clearing…' : 'Clear tab'}
          </button>
          <button
            type="button"
            disabled={clearing}
            onClick={() => clearLogs('all')}
            className="inline-flex items-center gap-1.5 rounded-[11px] border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-medium text-rose-600 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear all logs
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 rounded-[14px] border border-[var(--line)] bg-[var(--bg)] p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setHistoryName(null);
              setLoading(true);
            }}
            className={`rounded-[10px] px-3 py-1.5 text-xs font-medium transition ${
              tab === t.id && !historyName
                ? 'bg-[var(--a1soft)] text-[var(--a1)]'
                : 'text-[var(--ink3)] hover:bg-[var(--bg2)] hover:text-[var(--ink)]'
            }`}
            title={t.hint}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-[var(--line)] bg-[var(--bg)] p-3">
        <Search className="h-3.5 w-3.5 text-[var(--ink3)]" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setQ(search);
          }}
          placeholder="Search log lines…"
          className={`${inputClass} min-w-[200px] flex-1`}
        />
        <button
          type="button"
          onClick={() => setQ(search)}
          className="rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-1.5 text-xs font-medium text-[var(--ink)]"
        >
          Search
        </button>
        {q ? (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setQ('');
            }}
            className="text-[11px] text-[var(--ink3)] hover:text-[var(--ink)]"
          >
            Clear search
          </button>
        ) : null}
      </div>

      {msg ? <p className="text-xs text-[var(--a1)]">{msg}</p> : null}
      {err ? <p className="text-xs text-rose-500">{err}</p> : null}

      {files.length > 0 && (
        <p className="font-mono text-[10px] text-[var(--ink3)]">
          Files:{' '}
          {files.map((f) => `${f.name} (${f.stream}, ${Math.round(f.size / 1024)}KB)`).join(' · ')}
        </p>
      )}

      {historyName && (
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          <FileText className="h-3.5 w-3.5" />
          Viewing archive: {historyName}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setHistoryName(null);
              setLoading(true);
            }}
          >
            Back to live
          </button>
        </div>
      )}

      <div className="rounded-[14px] border border-[var(--line)] bg-[var(--bg)]">
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          className="flex w-full items-center gap-2 border-b border-[var(--line)] px-3 py-2 text-left text-xs font-medium text-[var(--ink2)]"
        >
          {historyOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          History ({archives.length})
        </button>
        {historyOpen && (
          <div className="max-h-40 space-y-1 overflow-y-auto p-2">
            {archives.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-[var(--ink3)]">
                No archives yet — cleared logs appear here.
              </p>
            ) : (
              archives.map((a) => (
                <button
                  key={a.name}
                  type="button"
                  onClick={() => {
                    setHistoryName(a.name);
                    setLoading(true);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] hover:bg-[var(--bg2)] ${
                    historyName === a.name ? 'bg-[var(--a1soft)] text-[var(--a1)]' : 'text-[var(--ink2)]'
                  }`}
                >
                  <span className="truncate font-mono">{a.name}</span>
                  <span className="shrink-0 text-[var(--ink3)]">
                    {new Date(a.mtime).toLocaleString()} · {Math.round(a.size / 1024)}KB
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-[14px] border border-[var(--line)] bg-[#0d1117]">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-[11px] text-white/50">
          <Terminal className="h-3.5 w-3.5" />
          {historyName ? 'Archive' : `Live · ${tab}`} · {lines.length} lines
        </div>
        <div className="max-h-[min(70vh,720px)] overflow-auto p-3 font-mono text-[11px] leading-relaxed text-[#c9d1d9]">
          {loading && lines.length === 0 ? (
            <p className="text-white/40">Loading…</p>
          ) : lines.length === 0 ? (
            <p className="text-white/40">No log lines found. Check PM2_HOME / log paths on the server.</p>
          ) : (
            <ul className="space-y-0.5">
              {lines.map((line, i) => (
                <li key={`${i}-${line.text.slice(0, 24)}`} className="flex gap-2">
                  <span
                    className={`mt-0.5 shrink-0 rounded px-1 py-0 text-[9px] uppercase ${streamBadge(line.stream)}`}
                  >
                    {line.stream === 'archive' ? 'arch' : line.stream}
                  </span>
                  <span className="whitespace-pre-wrap break-all">{line.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
