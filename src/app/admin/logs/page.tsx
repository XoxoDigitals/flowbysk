'use client';

import { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Search,
  RefreshCw,
  Terminal,
  CreditCard,
  ChevronDown,
  ChevronRight,
  Zap,
  Globe,
} from 'lucide-react';

interface SystemLogItem {
  id: string;
  category: 'AUTH' | 'GENERATION' | 'BILLING' | 'SYSTEM' | 'SECURITY_ALERT';
  level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  message: string;
  details: any;
  ipAddress: string | null;
  userId: string | null;
  createdAt: string;
}

interface Summary {
  total: number;
  securityAlertsCount: number;
  criticalCount: number;
  categoryCounts: Record<string, number>;
}

const inputClass =
  'rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-1.5 text-xs text-[var(--ink)] placeholder:text-[var(--ink3)] outline-none focus:border-[var(--a1)]';

function levelClass(level: string) {
  if (level === 'CRITICAL' || level === 'ERROR') return 'bg-rose-500/15 text-rose-500';
  if (level === 'WARN') return 'bg-[var(--a2soft)] text-[var(--a2)]';
  return 'bg-[var(--a1soft)] text-[var(--a1)]';
}

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<SystemLogItem[]>([]);
  const [summary, setSummary] = useState<Summary>({
    total: 0,
    securityAlertsCount: 0,
    criticalCount: 0,
    categoryCounts: {},
  });
  const [category, setCategory] = useState<string>('ALL');
  const [level, setLevel] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const fetchLogs = async () => {
    try {
      const queryParams = new URLSearchParams();
      if (category !== 'ALL') queryParams.set('category', category);
      if (level !== 'ALL') queryParams.set('level', level);
      if (search.trim()) queryParams.set('q', search.trim());

      const res = await fetch(`/api/admin/logs?${queryParams.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        if (data.summary) setSummary(data.summary);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 10000);
    return () => clearInterval(interval);
  }, [category, level, search]);

  const categories = [
    { id: 'ALL', label: 'All Categories' },
    { id: 'SECURITY_ALERT', label: 'Security & Alerts' },
    { id: 'GENERATION', label: 'Generation Jobs' },
    { id: 'BILLING', label: 'Billing & Orders' },
    { id: 'AUTH', label: 'Authentication' },
    { id: 'SYSTEM', label: 'Engine & System' },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <p className="flex items-center gap-2 text-[13px] text-[var(--ink3)]">
          <Terminal className="h-4 w-4 text-[var(--a1)]" />
          Security · generation · billing audit feed — refreshes every 10s
        </p>
        <button type="button" onClick={fetchLogs} className="btn-secondary !px-3 !py-2 !text-xs">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh Feed
        </button>
      </div>

      {summary.securityAlertsCount > 0 && (
        <div className="flex items-start gap-3 rounded-[18px] border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-500">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <span className="text-sm font-semibold text-[var(--ink)]">
              {summary.securityAlertsCount} Security Incident(s) Recorded
            </span>
            <p className="mt-0.5 text-[11px] text-rose-500/80">
              Review flagged unauthorized generation attempts, multi-IP concurrency violations, or high-velocity
              token alerts below.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <div className="flex flex-col gap-2 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-5">
          <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">TOTAL LOGS</span>
          <span className="text-[30px] font-semibold tracking-[-0.035em]">{logs.length}</span>
          <span className="text-xs text-[var(--ink3)]">{loading ? 'Loading…' : 'Live buffer entries'}</span>
        </div>
        <div className="flex flex-col gap-2 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-5">
          <span className="flex items-center gap-1 font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
            <ShieldAlert className="h-3 w-3 text-rose-500" />
            SECURITY
          </span>
          <span className="text-[30px] font-semibold tracking-[-0.035em] text-rose-500">
            {summary.securityAlertsCount}
          </span>
          <span className="text-xs text-[var(--ink3)]">High priority review</span>
        </div>
        <div className="flex flex-col gap-2 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-5">
          <span className="flex items-center gap-1 font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
            <Zap className="h-3 w-3 text-[var(--a1)]" />
            GENERATION
          </span>
          <span className="text-[30px] font-semibold tracking-[-0.035em]">
            {summary.categoryCounts.GENERATION || 0}
          </span>
          <span className="text-xs text-[var(--ink3)]">Veo & Nano operations</span>
        </div>
        <div className="flex flex-col gap-2 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-5">
          <span className="flex items-center gap-1 font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
            <CreditCard className="h-3 w-3 text-[var(--a1)]" />
            BILLING
          </span>
          <span className="text-[30px] font-semibold tracking-[-0.035em]">
            {summary.categoryCounts.BILLING || 0}
          </span>
          <span className="text-xs text-[var(--ink3)]">Payments & credit grants</span>
        </div>
      </div>

      <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--card)]">
        <div className="flex flex-col justify-between gap-4 border-b border-[var(--line)] p-4 md:flex-row md:items-center">
          <div className="flex flex-wrap items-center gap-1.5">
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategory(cat.id)}
                className={`rounded-[10px] px-3 py-1.5 text-xs font-semibold transition ${
                  category === cat.id
                    ? 'bg-[var(--a1soft)] text-[var(--a1)]'
                    : 'text-[var(--ink3)] hover:bg-[var(--bg2)] hover:text-[var(--ink)]'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <select value={level} onChange={(e) => setLevel(e.target.value)} className={inputClass}>
              <option value="ALL">All Severity Levels</option>
              <option value="INFO">INFO Only</option>
              <option value="WARN">WARN Only</option>
              <option value="ERROR">ERROR Only</option>
              <option value="CRITICAL">CRITICAL Only</option>
            </select>

            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-[var(--ink3)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search log messages..."
                className={`${inputClass} w-44 pl-8 sm:w-56`}
              />
            </div>
          </div>
        </div>

        {logs.length === 0 ? (
          <div className="p-12 text-center text-xs text-[var(--ink3)]">
            No system log records matching selected filter criteria.
          </div>
        ) : (
          <div>
            {logs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              return (
                <div
                  key={log.id}
                  className="space-y-2 border-t border-[var(--line)] p-4 text-xs hover:bg-[var(--bg2)]/40"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                        className="rounded p-1 text-[var(--ink3)] hover:text-[var(--ink)]"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>

                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold ${levelClass(log.level)}`}
                          >
                            {log.level}
                          </span>
                          <span className="rounded-md bg-[var(--bg2)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ink2)]">
                            {log.category}
                          </span>
                          <span className="font-mono text-[11px] text-[var(--ink3)]">
                            {new Date(log.createdAt).toLocaleTimeString()}
                          </span>
                          {log.ipAddress && (
                            <span className="flex items-center gap-1 rounded-md bg-[var(--bg2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink2)]">
                              <Globe className="h-2.5 w-2.5" />
                              {log.ipAddress}
                            </span>
                          )}
                        </div>
                        <p className="font-medium leading-relaxed text-[var(--ink)]">{log.message}</p>
                      </div>
                    </div>

                    <span className="whitespace-nowrap text-[10px] text-[var(--ink3)]">
                      {new Date(log.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  {isExpanded && log.details && (
                    <div className="ml-7 pt-2">
                      <div className="overflow-x-auto rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] p-3 font-mono text-[11px] text-[var(--a1)]">
                        <pre>{JSON.stringify(log.details, null, 2)}</pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
