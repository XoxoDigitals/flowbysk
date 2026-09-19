'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, ScrollText, ExternalLink } from 'lucide-react';

export type JobLogsTarget = {
  jobId: string;
  runId: string;
  prompt: string;
  status: string;
  tool: string;
  userId?: string | null;
};

type StudioLogEvent = {
  id: string;
  level: string;
  message: string;
  source: string;
  createdAt: string;
};

function levelClass(level: string) {
  const l = String(level || '').toUpperCase();
  if (l === 'ERROR') return 'bg-rose-500/15 text-rose-500';
  if (l === 'WARN') return 'bg-[var(--a2soft)] text-[var(--a2)]';
  if (l === 'DEBUG') return 'bg-[var(--bg3)] text-[var(--ink3)]';
  return 'bg-[var(--a1soft)] text-[var(--a1)]';
}

function formatTs(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function JobStudioLogsModal({
  target,
  onClose,
}: {
  target: JobLogsTarget | null;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<StudioLogEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setLogs([]);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          group: '0',
          limit: '200',
          runId: target.runId,
          jobId: target.jobId,
        });
        const res = await fetch(`/api/admin/studio-logs?${params}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load logs');
        if (cancelled) return;
        const list = Array.isArray(data.logs) ? data.logs : [];
        setLogs(
          [...list].sort(
            (a: StudioLogEvent, b: StudioLogEvent) =>
              new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          )
        );
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load logs');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  if (!target) return null;

  const studioLogsHref = target.userId
    ? `/admin/studio-logs?userId=${encodeURIComponent(target.userId)}`
    : '/admin/studio-logs';

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-[16px] border border-[var(--line)] bg-[var(--card)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ScrollText className="h-4 w-4 shrink-0 text-[var(--a1)]" />
              <span className="text-sm font-semibold text-[var(--ink)]">Generation logs</span>
              <span className="rounded-md bg-[var(--bg3)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink2)]">
                {target.tool || 'studio'}
              </span>
              <span className="rounded-md bg-[var(--bg3)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink2)]">
                {target.status}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-[var(--ink2)]" title={target.prompt}>
              {target.prompt || '—'}
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-[var(--ink3)]">
              run {target.runId.slice(0, 8)}… · job {target.jobId.slice(0, 8)}…
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-[var(--ink3)] hover:bg-[var(--bg2)] hover:text-[var(--ink)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="py-10 text-center text-xs text-[var(--ink3)]">Loading events…</div>
          ) : error ? (
            <div className="py-10 text-center text-xs text-rose-500">{error}</div>
          ) : logs.length === 0 ? (
            <div className="py-10 text-center text-xs text-[var(--ink3)]">
              No studio log events for this job yet
            </div>
          ) : (
            <ul className="space-y-2">
              {logs.map((ev) => (
                <li
                  key={ev.id}
                  className="rounded-[10px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] text-[var(--ink3)]">
                      {formatTs(ev.createdAt)}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${levelClass(ev.level)}`}
                    >
                      {ev.level}
                    </span>
                    <span className="text-[10px] text-[var(--ink3)]">{ev.source}</span>
                  </div>
                  <p className="text-xs leading-relaxed text-[var(--ink)]">{ev.message}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] px-4 py-3">
          <Link
            href={studioLogsHref}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--a1)] hover:underline"
            onClick={onClose}
          >
            Open in Studio Logs
            <ExternalLink className="h-3 w-3" />
          </Link>
          <button type="button" onClick={onClose} className="btn-secondary !px-3 !py-1.5 !text-xs">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
