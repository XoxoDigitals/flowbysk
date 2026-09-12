'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ListOrdered,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import {
  ANALYTICS_RANGES,
  AnalyticsRange,
  JobStatusFilter,
  parseAnalyticsRange,
  parseJobStatusFilter,
} from '@/lib/analytics-range';
import { formatModelDisplayName } from '@/lib/modelLabels';

interface GlobalJob {
  id: string;
  modelKey: string;
  walletType: string;
  creditCost: number;
  status: string;
  progress: number;
  prompt: string;
  errorMessage: string | null;
  outputMediaUrl: string | null;
  submittedAt: string;
  expiresAt: string;
  user: { email: string; name: string };
  project: { name: string };
  providerAccount: { label: string } | null;
}

const thClass =
  'px-4 py-3 text-left font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]';

const STATUS_CHIPS: { id: JobStatusFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'IN_QUEUE', label: 'In queue' },
  { id: 'ACTIVE', label: 'In progress' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'FAILED', label: 'Failed' },
];

function statusBadge(status: string) {
  if (status === 'COMPLETED') {
    return 'bg-[var(--a1soft)] text-[var(--a1)]';
  }
  if (status === 'FAILED' || status === 'CANCELLED') {
    return 'bg-rose-500/15 text-rose-500';
  }
  return 'bg-[var(--a2soft)] text-[var(--a2)]';
}

function AdminJobsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const range = parseAnalyticsRange(searchParams.get('range'));
  const status = parseJobStatusFilter(searchParams.get('status'));

  const [jobs, setJobs] = useState<GlobalJob[]>([]);
  const [loading, setLoading] = useState(true);

  const setFilters = (nextRange: AnalyticsRange, nextStatus: JobStatusFilter) => {
    const q = new URLSearchParams();
    q.set('range', nextRange);
    if (nextStatus !== 'ALL') q.set('status', nextStatus);
    router.replace(`/admin/jobs?${q.toString()}`);
  };

  const fetchJobs = useCallback(async () => {
    try {
      const q = new URLSearchParams({ range, status });
      const res = await fetch(`/api/admin/jobs?${q.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [range, status]);

  useEffect(() => {
    setLoading(true);
    fetchJobs();
    const interval = setInterval(fetchJobs, 8000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const handleAction = async (action: 'retry' | 'fail_and_refund', jobId: string) => {
    try {
      const res = await fetch('/api/admin/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, jobId }),
      });
      if (res.ok) {
        fetchJobs();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const rangeLabel = ANALYTICS_RANGES.find((r) => r.id === range)?.label || range;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[13px] text-[var(--ink3)]">
          <ListOrdered className="h-4 w-4 text-[var(--a1)]" />
          {rangeLabel}
          {status !== 'ALL' ? ` · ${status}` : ''} — refreshes every 8s
        </p>
        <button type="button" onClick={fetchJobs} className="btn-secondary !px-3 !py-2 !text-xs">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ANALYTICS_RANGES.map((r) => {
          const active = range === r.id;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setFilters(r.id, status)}
              className="rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors"
              style={{
                borderColor: active ? 'var(--a1)' : 'var(--line)',
                background: active ? 'var(--a1soft)' : 'transparent',
                color: active ? 'var(--ink)' : 'var(--ink2)',
              }}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STATUS_CHIPS.map((s) => {
          const active = status === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setFilters(range, s.id)}
              className="rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors"
              style={{
                borderColor: active ? 'var(--a2)' : 'var(--line)',
                background: active ? 'var(--a2soft)' : 'transparent',
                color: active ? 'var(--ink)' : 'var(--ink2)',
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--card)]">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr>
                <th className={thClass}>Job / Time</th>
                <th className={thClass}>Customer</th>
                <th className={thClass}>Model & Wallet</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>Provider</th>
                <th className={thClass}>Prompt</th>
                <th className={`${thClass} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && jobs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="border-t border-[var(--line)] px-4 py-10 text-center text-[var(--ink3)]">
                    Loading jobs…
                  </td>
                </tr>
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="border-t border-[var(--line)] px-4 py-10 text-center text-[var(--ink3)]">
                    No jobs for this range / status.
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id} className="border-t border-[var(--line)] hover:bg-[var(--bg2)]/50">
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="font-mono font-semibold text-[var(--ink)]">{job.id.slice(0, 8)}…</div>
                      <div className="text-[10px] text-[var(--ink3)]">
                        {new Date(job.submittedAt).toLocaleString()}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--ink)]">{job.user?.name}</div>
                      <div className="text-[10px] text-[var(--ink3)]">{job.user?.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[var(--ink2)]">
                        {formatModelDisplayName(
                          job.modelKey,
                          (job.modelKey || '').toLowerCase().includes('veo') ||
                            (job.modelKey || '').toLowerCase().includes('omni')
                            ? 'video'
                            : 'image'
                        )}
                      </span>
                      <div className="text-[10px] text-[var(--ink3)]">
                        {job.creditCost} {job.walletType}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${statusBadge(job.status)}`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--ink2)]">
                      {job.providerAccount?.label || 'Unassigned / Queued'}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-[var(--ink2)]" title={job.prompt}>
                      &ldquo;{job.prompt}&rdquo;
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {job.status === 'FAILED' && (
                          <button
                            type="button"
                            onClick={() => handleAction('retry', job.id)}
                            className="btn-secondary !px-2 !py-1 !text-[10px]"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Retry
                          </button>
                        )}
                        {(job.status === 'IN_QUEUE' || job.status === 'PREPARING') && (
                          <button
                            type="button"
                            onClick={() => handleAction('fail_and_refund', job.id)}
                            className="rounded-lg bg-rose-500/15 px-2 py-1 text-[10px] font-semibold text-rose-500 hover:bg-rose-500/25"
                          >
                            <span className="inline-flex items-center gap-1">
                              <ShieldAlert className="h-3 w-3" />
                              Refund
                            </span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function AdminJobsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--ink3)]">Loading jobs…</p>}>
      <AdminJobsInner />
    </Suspense>
  );
}
