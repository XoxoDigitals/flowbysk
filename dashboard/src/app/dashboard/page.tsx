'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { downloadFlowAndroidUrl, downloadFlowUrl, FLOW_API, flowFetch } from '@/lib/flowApi';

type Me = {
  credits: number;
  planExpiry: string;
  plan?: string;
  isActive: boolean;
  ownerLabel?: string | null;
};

type DownloadMeta = {
  originalName: string;
  size: number;
  updatedAt: string | null;
} | null;

export default function DashboardPage() {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowsPkg, setWindowsPkg] = useState<DownloadMeta>(null);
  const [androidPkg, setAndroidPkg] = useState<DownloadMeta>(null);

  useEffect(() => {
    flowFetch('/api/v2/client/me')
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        setUser(data.user);
      })
      .finally(() => setLoading(false));

    fetch(`${FLOW_API}/download/status`)
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        setWindowsPkg(data.downloads?.windows || null);
        setAndroidPkg(data.downloads?.android || null);
      })
      .catch(() => {
        setWindowsPkg(null);
        setAndroidPkg(null);
      });
  }, []);

  const expiry = user?.planExpiry ? new Date(user.planExpiry) : null;
  const expired = expiry ? expiry.getTime() <= Date.now() : false;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3.5 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">PLAN</span>
          <div className="mt-2 text-[28px] font-semibold tracking-[-0.03em]">{user?.plan || 'Standard'}</div>
          {user?.ownerLabel && user.ownerLabel !== '—' && (
            <p className="mt-1 text-xs text-[var(--ink3)]">Added by {user.ownerLabel}</p>
          )}
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">STANDARD CREDITS</span>
          <div className="mt-2 text-[28px] font-semibold tracking-[-0.03em]">
            {loading ? '…' : (user?.credits ?? 0).toLocaleString()}
          </div>
          <p className="mt-1 text-xs text-[var(--ink3)]">Single credit balance</p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">PLAN EXPIRY</span>
          <div className="mt-2 text-[28px] font-semibold tracking-[-0.03em]">
            {expiry ? expiry.toLocaleDateString() : '—'}
          </div>
          <p className="mt-1 text-xs" style={{ color: expired ? 'var(--a2)' : 'var(--a1)' }}>
            {expired ? 'Expired' : user?.isActive === false ? 'Inactive' : 'Active'}
          </p>
        </div>
      </div>

      <div className="flex w-full flex-col items-start gap-6 rounded-[28px] border border-[var(--a1)] bg-[var(--card)] px-8 py-12 sm:px-14 sm:py-16">
        <span className="font-mono text-[12px] tracking-[0.18em] text-[var(--a1)]">FLOW CREATOR AI</span>
        <h3 className="text-5xl font-semibold tracking-[-0.045em] sm:text-7xl">Download Flow</h3>
        <p className="max-w-2xl text-lg text-[var(--ink2)]">
          Run the Windows or Android client. It signs in with this account and receives the shared Google login from the same server.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          {windowsPkg ? (
            <a
              href={downloadFlowUrl()}
              download={windowsPkg.originalName}
              className="btn-primary !px-8 !py-4 !text-lg"
            >
              <Download className="h-6 w-6" />
              Download for Windows
            </a>
          ) : (
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="btn-primary !px-8 !py-4 !text-lg cursor-not-allowed opacity-60"
            >
              <Download className="h-6 w-6" />
              Download for Windows
              <span className="text-base font-medium">Not available yet</span>
            </button>
          )}
          {androidPkg ? (
            <a
              href={downloadFlowAndroidUrl()}
              download={androidPkg.originalName}
              className="btn-primary !px-8 !py-4 !text-lg"
            >
              <Download className="h-6 w-6" />
              Download for Android
            </a>
          ) : (
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="btn-primary !px-8 !py-4 !text-lg cursor-not-allowed opacity-60"
            >
              <Download className="h-6 w-6" />
              Download for Android
              <span className="text-base font-medium">Coming soon</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
