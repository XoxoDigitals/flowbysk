'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FolderPlus, FolderKanban, Sparkles } from 'lucide-react';
import { formatModelDisplayName } from '@/lib/modelLabels';

interface ProjectData {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  _count: { jobs: number; characters: number; assets: number };
}

interface JobData {
  id: string;
  modelKey: string;
  walletType: string;
  creditCost: number;
  status: string;
  prompt: string;
  outputMediaUrl: string | null;
  createdAt: string;
}

export default function DashboardPage() {
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [loading, setLoading] = useState(true);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState('');
  const [wallets, setWallets] = useState({
    standard: { available: 0, total: 0 },
    pro: { available: 0, total: 0 },
  });

  const load = async () => {
    try {
      const [pRes, gRes, wRes] = await Promise.all([
        fetch('/api/projects'),
        fetch('/api/generations?all=1&analytics=1'),
        fetch('/api/wallet'),
      ]);
      if (pRes.ok) {
        const data = await pRes.json();
        setProjects(data.projects || []);
      }
      if (gRes.ok) {
        const data = await gRes.json();
        setJobs(data.jobs || data.generations || []);
      }
      if (wRes.ok) {
        const data = await wRes.json();
        if (data.wallets) setWallets(data.wallets);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const analytics = useMemo(() => {
    let videos = 0;
    let images = 0;
    let creditsUsed = 0;
    let completed = 0;
    let failed = 0;
    let active = 0;
    let queued = 0;
    for (const j of jobs) {
      const m = (j.modelKey || '').toLowerCase();
      if (m.includes('veo') || m.includes('omni') || m.includes('video')) videos++;
      else images++;
      if (j.status === 'COMPLETED') {
        completed++;
        creditsUsed += j.creditCost || 0;
      }
      // Stop by user / cancel is CANCELLED (or FAILED with stop message) — never count in failure rate
      if (j.status === 'FAILED') {
        const err = String((j as { errorMessage?: string }).errorMessage || '');
        if (!/stop by user|cancelled by user|canceled by user/i.test(err)) failed++;
      }
      if (['PREPARING', 'GENERATING', 'RETRYING'].includes(j.status)) active++;
      if (j.status === 'IN_QUEUE') queued++;
    }
    const decided = completed + failed;
    const successRate = decided > 0 ? Math.round((completed / decided) * 100) : 100;
    return {
      videos,
      images,
      creditsUsed,
      completed,
      failed,
      active,
      queued,
      total: jobs.length,
      successRate,
      creditsLeft: wallets.standard.available + wallets.pro.available,
    };
  }, [jobs, wallets]);

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    setCreatingProject(true);
    setError('');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create project');
      setShowCreateModal(false);
      setNewProjectName('');
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed');
    } finally {
      setCreatingProject(false);
    }
  };

  const recent = jobs.slice(0, 8);

  const cards = [
    {
      label: 'CREDITS USED',
      value: analytics.creditsUsed.toLocaleString(),
      hint: `${analytics.creditsLeft.toLocaleString()} left`,
      hintColor: 'var(--a1)',
    },
    {
      label: 'SUCCESS RATE',
      value: `${analytics.successRate}%`,
      hint: `${analytics.completed} completed · ${analytics.failed} failed`,
      hintColor: analytics.successRate >= 80 ? 'var(--a1)' : 'var(--a2)',
    },
    {
      label: 'IN PROGRESS',
      value: String(analytics.active),
      hint: 'Preparing / generating',
    },
    {
      label: 'IN QUEUE',
      value: String(analytics.queued),
      hint: 'Waiting for a slot',
    },
    {
      label: 'VIDEOS',
      value: String(analytics.videos),
      hint: `${analytics.completed} done`,
    },
    {
      label: 'IMAGES',
      value: String(analytics.images),
      hint: `${analytics.total} total jobs`,
    },
    {
      label: 'STANDARD CR',
      value: String(wallets.standard.available),
      hint: 'Available',
    },
    {
      label: 'PRO CR',
      value: String(wallets.pro.available),
      hint: 'Available',
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="flex flex-col gap-2 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5"
          >
            <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
              {c.label}
            </span>
            <span className="text-[30px] font-semibold tracking-[-0.035em]">{c.value}</span>
            <span className="text-xs" style={{ color: c.hintColor || 'var(--ink3)' }}>
              {c.hint}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-[22px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold tracking-[-0.02em]">Projects</h3>
            <span className="text-[13px] text-[var(--ink3)]">
              Launch Studio from a project, or open Create
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="btn-secondary !px-3 !py-2 !text-xs"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              New
            </button>
            <Link href="/dashboard/create" className="btn-primary !px-3 !py-2 !text-xs">
              <Sparkles className="h-3.5 w-3.5" />
              Create
            </Link>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-[var(--ink3)]">Loading…</p>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <FolderKanban className="h-8 w-8 text-[var(--ink3)]" />
            <p className="text-sm text-[var(--ink2)]">No projects yet</p>
            <button type="button" onClick={() => setShowCreateModal(true)} className="btn-primary">
              Create project
            </button>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {projects.slice(0, 6).map((proj) => (
              <div
                key={proj.id}
                className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg2)] px-3.5 py-3"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-[var(--line)] bg-[var(--a1soft)]">
                  <FolderKanban className="h-4 w-4 text-[var(--a1)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{proj.name}</p>
                  <p className="font-mono text-[11px] text-[var(--ink3)]">
                    {proj._count?.jobs ?? 0} jobs · {proj._count?.assets ?? 0} assets
                  </p>
                </div>
                <Link
                  href={`/dashboard/studio?project=${encodeURIComponent(proj.id)}`}
                  className="btn-primary shrink-0 !px-3 !py-2 !text-xs"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Launch
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-[22px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-semibold tracking-[-0.02em]">Recent activity</h3>
          <Link href="/dashboard/library" className="text-[13px] font-medium text-[var(--a1)]">
            View library
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--ink3)]">
            No generations yet. Open Create to pick a project and launch Studio.
          </p>
        ) : (
          <div className="flex flex-col">
            {recent.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-1 items-center gap-2 border-t border-[var(--line)] py-3 sm:grid-cols-[2.4fr_1fr_0.8fr_0.8fr] sm:gap-3.5"
              >
                <span className="truncate text-sm">{row.prompt || 'Generation'}</span>
                <span className="truncate text-[13px] text-[var(--ink2)]">
                  {formatModelDisplayName(
                    row.modelKey,
                    (row.modelKey || '').toLowerCase().includes('veo') ||
                      (row.modelKey || '').toLowerCase().includes('omni')
                      ? 'video'
                      : 'image'
                  )}
                </span>
                <span className="font-mono text-[13px] text-[var(--ink2)]">{row.creditCost} CR</span>
                <span className="text-right text-xs text-[var(--ink3)]">
                  {row.status} · {new Date(row.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6">
            <h3 className="text-lg font-semibold">Create project</h3>
            <input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
              className="w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3.5 py-3 text-[15px] outline-none focus:border-[var(--a1)]"
              onKeyDown={(e) => e.key === 'Enter' && createProject()}
            />
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setShowCreateModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={creatingProject || !newProjectName.trim()}
                onClick={createProject}
              >
                {creatingProject ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
