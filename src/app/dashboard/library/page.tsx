'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ImageIcon, Search } from 'lucide-react';
import {
  isCompletedMediaExpired,
  parseExpiresFromMediaUrl,
  resolveMediaExpiresAt,
} from '@/lib/mediaExpiry';

interface MediaItem {
  id: string;
  modelKey: string;
  creditCost: number;
  status: string;
  prompt: string;
  outputMediaUrl: string | null;
  createdAt: string;
  expiresAt?: string | null;
  progress?: number;
}

type Filter = 'all' | 'video' | 'image';

function isVideo(modelKey: string) {
  const m = (modelKey || '').toLowerCase();
  return m.includes('veo') || m.includes('omni') || m.includes('video');
}

function isUsableMedia(item: MediaItem) {
  return item.status === 'COMPLETED' && Boolean(item.outputMediaUrl?.trim());
}

/** Prefer Google CDN Expires=; fall back to DB expiresAt. */
function resolveItemExpiresAt(item: MediaItem): Date | null {
  return resolveMediaExpiresAt(item.outputMediaUrl, item.expiresAt);
}

function formatExpiryLeft(expiresAt: Date | string | null | undefined): string {
  if (!expiresAt) return '';
  const ms = (expiresAt instanceof Date ? expiresAt : new Date(expiresAt)).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return 'Expired';
  const totalMins = Math.floor(ms / 60000);
  if (totalMins < 1) return '<1m left';
  if (totalMins < 60) return `${totalMins}m left`;
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours < 48) {
    return mins > 0 ? `${hours}h ${mins}m left` : `${hours}h left`;
  }
  return `${Math.floor(hours / 24)}d left`;
}

export default function LibraryPage() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/generations?all=1');
        if (res.ok) {
          const data = await res.json();
          const jobs = (data.jobs || []) as MediaItem[];
          setItems(
            jobs.filter((job) => {
              if (!isUsableMedia(job)) return false;
              if (isCompletedMediaExpired(job.outputMediaUrl, job.expiresAt)) return false;
              return true;
            })
          );
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const purgeBroken = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    fetch(`/api/assets?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (!isUsableMedia(item)) return false;
      if (isCompletedMediaExpired(item.outputMediaUrl, item.expiresAt)) return false;
      const video = isVideo(item.modelKey);
      if (filter === 'video' && !video) return false;
      if (filter === 'image' && video) return false;
      if (
        q &&
        !(item.prompt || '').toLowerCase().includes(q) &&
        !(item.modelKey || '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [items, filter, search, nowTick]);

  const chip = (id: Filter, label: string) => {
    const active = filter === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => setFilter(id)}
        className="rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors"
        style={{
          borderColor: active ? 'var(--a1)' : 'var(--line)',
          background: active ? 'var(--a1soft)' : 'transparent',
          color: active ? 'var(--ink)' : 'var(--ink2)',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-center gap-2">
        {chip('all', 'All')}
        {chip('video', 'Video')}
        {chip('image', 'Image')}
        <div className="flex-1" />
        <div className="relative min-w-[180px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink3)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search prompts…"
            className="w-full rounded-[10px] border border-[var(--line)] bg-[var(--card)] py-2 pl-9 pr-3.5 text-[13px] outline-none focus:border-[var(--a1)]"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--ink3)]">Loading library…</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[18px] border border-dashed border-[var(--line)] bg-[var(--card)] py-16 text-center">
          <ImageIcon className="h-10 w-10 text-[var(--ink3)]" />
          <h3 className="text-base font-semibold">No media yet</h3>
          <p className="max-w-sm text-[13px] text-[var(--ink3)]">
            Generations from Studio appear here. Pick a project under Create to start.
          </p>
          <Link href="/dashboard/create" className="btn-primary">
            Go to Create
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,210px),1fr))] gap-3.5">
          {filtered.map((item) => {
            const video = isVideo(item.modelKey);
            const url = item.outputMediaUrl!;
            const expiresAt = resolveItemExpiresAt(item);
            const expiryLabel = formatExpiryLeft(expiresAt);
            const expiryTitle = expiresAt
              ? `Expires ${expiresAt.toLocaleString()}${
                  parseExpiresFromMediaUrl(url) ? ' (from Google CDN link)' : ''
                }`
              : undefined;
            void nowTick;
            return (
              <div
                key={item.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] transition-colors hover:border-[var(--line2)]"
              >
                <div className="relative aspect-video bg-[var(--bg2)]">
                  {video ? (
                    <video
                      src={url}
                      className="h-full w-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                      onError={() => purgeBroken(item.id)}
                    />
                  ) : (
                    <img
                      src={url}
                      alt=""
                      className="h-full w-full object-cover"
                      onError={() => purgeBroken(item.id)}
                    />
                  )}
                  <span className="absolute left-2.5 top-2.5 rounded-md bg-black/65 px-2 py-1 font-mono text-[9px] tracking-[0.06em] text-white">
                    {video ? 'VIDEO' : 'IMAGE'}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 px-3.5 pb-4 pt-3">
                  <span className="truncate text-[13px] font-medium leading-snug text-[var(--ink)]">
                    {item.prompt || item.modelKey}
                  </span>
                  <div className="flex justify-between gap-2 font-mono text-[11px] text-[var(--ink2)]">
                    <span>{item.creditCost} CR</span>
                    <span title={expiryTitle}>
                      {expiryLabel || new Date(item.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
