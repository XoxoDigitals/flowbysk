'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FolderPlus, FolderKanban, Sparkles } from 'lucide-react';

interface ProjectData {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  _count: { jobs: number; characters: number; assets: number };
}

export default function CreateProjectsPage() {
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [loading, setLoading] = useState(true);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
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

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-[-0.02em]">Choose a project</h3>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">
            Launch Studio from a project workspace — nothing opens until you click Launch.
          </p>
        </div>
        <button type="button" onClick={() => setShowCreateModal(true)} className="btn-primary !text-[13px]">
          <FolderPlus className="h-3.5 w-3.5" />
          New project
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--ink3)]">Loading projects…</p>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[18px] border border-dashed border-[var(--line)] bg-[var(--card)] py-16 text-center">
          <FolderKanban className="h-10 w-10 text-[var(--ink3)]" />
          <h3 className="text-base font-semibold">No projects yet</h3>
          <p className="max-w-sm text-[13px] text-[var(--ink3)]">
            Create a project first, then launch Studio to generate.
          </p>
          <button type="button" onClick={() => setShowCreateModal(true)} className="btn-primary">
            Create project
          </button>
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((proj) => (
            <div
              key={proj.id}
              className="flex flex-col gap-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-5"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-[var(--line)] bg-[var(--a1soft)]">
                  <FolderKanban className="h-5 w-5 text-[var(--a1)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-[15px] font-semibold tracking-[-0.02em]">
                    {proj.name}
                  </h4>
                  <p className="mt-1 font-mono text-[11px] text-[var(--ink3)]">
                    {proj._count?.jobs ?? 0} jobs · {proj._count?.assets ?? 0} assets
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink3)]">
                    Updated {new Date(proj.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <Link
                href={`/dashboard/studio?project=${encodeURIComponent(proj.id)}`}
                className="btn-primary w-full !py-2.5"
              >
                <Sparkles className="h-4 w-4" />
                Launch Studio
              </Link>
            </div>
          ))}
        </div>
      )}

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
