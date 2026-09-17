'use client';

import { useState, useEffect } from 'react';
import {
  Server,
  Plus,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Lock,
  Cpu,
  Shield,
  Layers,
  Trash2,
  Edit3,
  Clock,
  Coins,
  Sparkles,
  Zap,
  FolderKanban,
  ExternalLink,
  Copy,
  Check,
  Play,
  Unplug,
  MonitorPlay,
  RefreshCcw,
  Globe,
} from 'lucide-react';

interface AccountItem {
  id: string;
  label: string;
  accountEmail: string;
  status: string;
  planName?: string;
  planTier?: string;
  creditClassification: string;
  googleCreditsBalance: number;
  googleCreditsReserved: number;
  maxUsersLimit?: number;
  maxParallelLimit?: number;
  activeUsersCount: number;
  onlineAssignedCount?: number;
  availableUserSlots?: number;
  activeJobsCount: number;
  loadScore?: number;
  projectUrl?: string | null;
  activeProjectId?: string | null;
  cookiesPreview: string | null;
  lastHealthCheck: string | null;
  cookieExpiresAt: string | null;
  createdAt: string;
  browserStatus?: string;
  flowProjectIds?: string[] | null;
  bibLastError?: string | null;
  assignedUsers?: {
    id: string;
    name: string | null;
    email: string;
    lastSeenAt: string | null;
    isOnline: boolean;
    hasActiveJobs: boolean;
    isManual?: boolean;
  }[];
  flowProjects?: {
    id: string;
    url: string;
    assignedUser?: { id: string; name: string | null; email: string } | null;
    usedBy: { id: string; name: string | null; email: string }[];
  }[];
  egressProxyUrl?: string | null;
  egressProxyMasked?: string | null;
  egressIp?: string | null;
  egressCountry?: string | null;
  egressProxyId?: string | null;
}

export default function AdminAccountsPage() {
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountItem | null>(null);
  const [loading, setLoading] = useState(true);

  // Add form state
  const [label, setLabel] = useState('');
  const [accountEmail, setAccountEmail] = useState('');
  const [planTier, setPlanTier] = useState('Google AI Ultra');
  const [projectUrl, setProjectUrl] = useState('');
  const [maxParallelLimit, setMaxParallelLimit] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [bibBusyId, setBibBusyId] = useState<string | null>(null);
  const [bibViewer, setBibViewer] = useState<{ id: string; url: string; label: string } | null>(null);

  // Refreshing specific card
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [creatingProjectForId, setCreatingProjectForId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [lastProxyRotateAt, setLastProxyRotateAt] = useState<string | null>(null);
  const [lastProxyRotateReason, setLastProxyRotateReason] = useState<string | null>(null);
  const [rotatingProxyId, setRotatingProxyId] = useState<string | null>(null);
  const [rotateMsgById, setRotateMsgById] = useState<Record<string, string>>({});

  // Edit form state
  const [editPlanTier, setEditPlanTier] = useState('Google AI Ultra');
  const [editProjectUrl, setEditProjectUrl] = useState('');
  const [editMaxParallelLimit, setEditMaxParallelLimit] = useState(5);

  const fetchProxyMeta = async () => {
    try {
      const res = await fetch('/api/admin/egress-proxies');
      if (!res.ok) return;
      const data = await res.json();
      if (data.lastProxyRotateAt) setLastProxyRotateAt(data.lastProxyRotateAt);
      if (typeof data.lastProxyRotateReason === 'string') {
        setLastProxyRotateReason(data.lastProxyRotateReason);
      }
    } catch {
      /* ignore */
    }
  };

  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/admin/accounts');
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
    fetchProxyMeta();
  }, []);

  const handleRotateProxy = async (accountId: string) => {
    if (
      !confirm(
        'Rotate this account to the next unique egress proxy and relaunch BiB? Google login is kept on the same profile.'
      )
    ) {
      return;
    }
    setRotatingProxyId(accountId);
    setRotateMsgById((m) => ({ ...m, [accountId]: 'Rotating proxy…' }));
    try {
      const res = await fetch('/api/admin/egress-proxies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rotate-account', accountId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rotate failed');
      if (data.lastProxyRotateAt) setLastProxyRotateAt(data.lastProxyRotateAt);
      if (typeof data.lastProxyRotateReason === 'string') {
        setLastProxyRotateReason(data.lastProxyRotateReason);
      }
      await fetchAccounts();
      setRotateMsgById((m) => ({
        ...m,
        [accountId]: data.rotated
          ? `Rotated · relaunched ${data.relaunched || 0}`
          : data.error || 'Rotate did not complete',
      }));
    } catch (err: any) {
      setRotateMsgById((m) => ({ ...m, [accountId]: err.message || 'Rotate failed' }));
    } finally {
      setRotatingProxyId(null);
      setTimeout(() => {
        setRotateMsgById((m) => {
          const next = { ...m };
          delete next[accountId];
          return next;
        });
      }, 6000);
    }
  };

  const handleCopyProjectUrl = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();

    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim() || undefined,
          accountEmail: accountEmail.trim() || undefined,
          planTier,
          projectUrl: projectUrl.trim() || undefined,
          maxParallelLimit,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const newId = data.account?.id as string | undefined;
        setShowAddModal(false);
        setLabel('');
        setAccountEmail('');
        setProjectUrl('');
        setPlanTier('Google AI Ultra');
        setMaxParallelLimit(5);
        await fetchAccounts();

        // BiB path: launch browser + open login stream right away
        if (newId) {
          const launchData = await handleBibAction(newId, 'launch');
          if (launchData?.viewerUrl) {
            setBibViewer({
              id: newId,
              url: launchData.viewerUrl,
              label: data.account?.label || label || 'New account',
            });
          }
        }
      } else {
        alert(data.error || 'Failed to add provider account');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  // Re-detect live account credentials & credits
  const handleRefreshAccount = async (accId: string) => {
    setRefreshingId(accId);
    try {
      const res = await fetch('/api/admin/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: accId, action: 'refresh' }),
      });

      if (res.ok) {
        fetchAccounts();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to refresh account');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to refresh account');
    } finally {
      setRefreshingId(null);
    }
  };

  // Create a brand new project on Google Flow for this provider account
  const handleCreateProjectForAccount = async (accId: string) => {
    setCreatingProjectForId(accId);
    try {
      const res = await fetch('/api/admin/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: accId, action: 'create_project' }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (editingAccount && editingAccount.id === accId && data.account?.projectUrl) {
          setEditProjectUrl(data.account.projectUrl);
        }
        fetchAccounts();
      } else {
        alert(data.error || 'Failed to create Google Flow project');
      }
    } catch (err: any) {
      alert(err.message || 'Error creating Google Flow project');
    } finally {
      setCreatingProjectForId(null);
    }
  };

  const handleDeleteAccount = async (accId: string, accLabel: string) => {
    if (
      !confirm(
        `Are you sure you want to delete "${accLabel}" from the Provider Account Pool? All active bindings will be removed.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/accounts?id=${accId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchAccounts();
      } else {
        alert('Failed to delete account');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleBibAction = async (accountId: string, action: string, extra?: Record<string, unknown>) => {
    setBibBusyId(accountId);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/bib`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'BiB action failed');
      if ((action === 'launch' || action === 'open_project' || action === 'navigate') && data.viewerUrl) {
        const acc = accounts.find((a) => a.id === accountId);
        setBibViewer({ id: accountId, url: data.viewerUrl, label: acc?.label || accountId });
      }
      await fetchAccounts();
      return data;
    } catch (err: any) {
      alert(err.message || 'BiB action failed');
    } finally {
      setBibBusyId(null);
    }
  };

  const handleOpenEdit = (acc: AccountItem) => {
    setEditingAccount(acc);
    setEditPlanTier(acc.planTier || acc.planName || 'Google AI Ultra');
    setEditProjectUrl(acc.projectUrl || '');
    setEditMaxParallelLimit(acc.maxUsersLimit || acc.maxParallelLimit || 5);
    setShowEditModal(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount) return;
    setSubmitting(true);
    try {
      const payload: any = {
        id: editingAccount.id,
        planTier: editPlanTier,
        projectUrl: editProjectUrl.trim() || undefined,
        maxParallelLimit: editMaxParallelLimit,
      };
      const res = await fetch('/api/admin/accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setShowEditModal(false);
        setEditingAccount(null);
        fetchAccounts();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to update account');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const getCookieExpiryDisplay = (expiresAt: string | null) => {
    if (!expiresAt) return { text: 'Active (No expiry set)', status: 'normal' };
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return { text: 'EXPIRED', status: 'expired' };
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 2) return { text: `Expires in ${days}d ${hours}h`, status: 'healthy' };
    return { text: `Expires in ${days}d ${hours}h`, status: 'warning' };
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--ink)] tracking-tight flex items-center gap-2">
            <Server className="w-5 h-5 text-[var(--a1)]" />
            Google Flow Provider Accounts Pool
          </h1>
          <p className="text-xs text-[var(--ink3)] mt-1">
            Upstream Google Flow accounts, real-time plans (Ultra/Pro), live Google credits, dedicated project URLs, and cookie health
          </p>
        </div>

        <button
          onClick={() => {
            setShowAddModal(true);
          }}
          className="btn-primary !px-4 !py-2.5 !text-xs"
        >
          <Plus className="w-4 h-4" />
          Add / Connect Google Account
        </button>
      </div>

      {/* Account Pool Smart Routing Rules Card */}
      <div className="p-5 rounded-[18px] border border-[var(--line)] bg-[var(--card)] space-y-2 text-xs">
        <span className="font-bold text-[var(--ink)] flex items-center gap-2">
          <Shield className="w-4 h-4 text-[var(--a1)]" />
          Smart Allocation & Concurrency Policy
        </span>
        <div className="text-[var(--ink2)] leading-relaxed grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
          <div className="p-3 rounded-[11px] border border-[var(--line)] bg-[var(--bg2)]">
            <div className="font-semibold text-[var(--a1)] mb-1">Configurable Parallel Limit</div>
            <div className="text-[11px] text-[var(--ink3)]">
              Each account dynamically enforces its configured user capacity (customizable per account, default 5) before queuing.
            </div>
          </div>
          <div className="p-3 rounded-[11px] border border-[var(--line)] bg-[var(--bg2)]">
            <div className="font-semibold text-[var(--ink2)] mb-1">Real-Time Plan & Credits</div>
            <div className="text-[11px] text-[var(--ink3)]">
              Detects Google AI Ultra (5,000 cr) or Google AI Pro (1,000 cr) and syncs live credit balance across jobs.
            </div>
          </div>
          <div className="p-3 rounded-[11px] border border-[var(--line)] bg-[var(--bg2)]">
            <div className="font-semibold text-[var(--a1)] mb-1">Dedicated Project Routing (Admin Only)</div>
            <div className="text-[11px] text-[var(--ink3)]">
              All generations for an account are dispatched into its assigned Google Flow project URL, auto-created on cookie renewal.
            </div>
          </div>
        </div>
      </div>

      {/* Accounts List Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {accounts.map((acc) => {
          const maxUsers = acc.maxUsersLimit && acc.maxUsersLimit > 0 ? acc.maxUsersLimit : (acc.maxParallelLimit && acc.maxParallelLimit > 0 ? acc.maxParallelLimit : 5);
          const userPct = Math.min(100, Math.round((acc.activeUsersCount / maxUsers) * 100));
          const isRefreshing = refreshingId === acc.id;
          const planBadge = acc.planTier || acc.planName || (acc.label.includes('Ultra') ? 'Google AI Ultra' : 'Google AI Pro');
          const isUltra = planBadge.toLowerCase().includes('ultra');
          const isPro = planBadge.toLowerCase().includes('pro');

          return (
            <div
              key={acc.id}
              className="p-5 rounded-[18px] border border-[var(--line)] bg-[var(--card)] flex flex-col justify-between hover:border-[var(--line2)] transition-all space-y-4"
            >
              <div>
                {/* Header: Label + Badges */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <h3 className="font-bold text-[var(--ink)] text-sm tracking-tight">{acc.label}</h3>
                    <div className="text-[11px] text-[var(--ink3)] font-mono flex items-center gap-1.5 mt-0.5">
                      <Lock className="w-3 h-3 text-[var(--ink3)]" />
                      <span>{acc.accountEmail || 'operator@google.com'}</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        isUltra
                          ? 'bg-[var(--a2soft)] text-[var(--a2)] border-[var(--a2)]/30'
                          : isPro
                          ? 'bg-[var(--a1soft)] text-[var(--a1)] border-[var(--a1)]/30'
                          : 'bg-[var(--bg2)] text-[var(--ink2)] border-[var(--line)]'
                      }`}
                    >
                      {planBadge}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        acc.status === 'HEALTHY' || acc.browserStatus === 'READY'
                          ? 'bg-[var(--a1soft)] text-[var(--a1)]'
                          : 'bg-rose-500/15 text-rose-500'
                      }`}
                    >
                      {acc.browserStatus === 'READY' && acc.status !== 'HEALTHY'
                        ? 'HEALTHY (BiB)'
                        : acc.status}
                    </span>
                  </div>
                </div>

                {/* Configurable Users Allocation Capacity Bar */}
                <div className="mb-3 p-2.5 rounded-[11px] border border-[var(--line)] bg-[var(--bg2)]">
                  <div className="flex justify-between items-center text-[11px] mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[var(--ink3)] font-medium">User Allocation Capacity:</span>
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(acc)}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--a1soft)] hover:bg-[var(--a1soft)] text-[var(--a1)] font-semibold border border-[var(--a1)]/30 transition-all flex items-center gap-1 cursor-pointer"
                        title="Update user allocation capacity for this account"
                      >
                        <Edit3 className="w-2.5 h-2.5" />
                        <span>Edit Capacity</span>
                      </button>
                    </div>
                    <span className="font-bold text-[var(--ink)] font-mono">
                      {acc.activeUsersCount} / {maxUsers} ({userPct}%)
                    </span>
                  </div>
                  <div className="w-full bg-[var(--bg2)] h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        userPct > 80
                          ? 'bg-[var(--a2)]'
                          : 'bg-[var(--a1)]'
                      }`}
                      style={{ width: `${Math.max(4, userPct)}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-[var(--ink3)] mt-1 flex justify-between">
                    <span>
                      {Math.max(0, maxUsers - acc.activeUsersCount)} user slots free
                    </span>
                    <span>
                      {acc.onlineAssignedCount || 0} online · {acc.activeJobsCount} active jobs
                    </span>
                  </div>
                </div>

                {/* Assigned users */}
                <div className="mb-3 rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] p-2.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-medium text-[var(--ink3)]">Active user allocation</span>
                    <span className="font-mono text-[10px] text-[var(--ink3)]">
                      {(acc.assignedUsers || []).length} assigned
                    </span>
                  </div>
                  {(acc.assignedUsers || []).length === 0 ? (
                    <p className="text-[11px] text-[var(--ink3)]">No users assigned right now.</p>
                  ) : (
                    <div className="flex max-h-[120px] flex-col gap-1.5 overflow-y-auto">
                      {(acc.assignedUsers || []).map((u) => (
                        <div
                          key={u.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--card)] px-2 py-1.5"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-medium text-[var(--ink)]">
                              {u.name || u.email.split('@')[0]}
                            </p>
                            <p className="truncate font-mono text-[10px] text-[var(--ink3)]">{u.email}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {u.isManual && (
                              <span className="rounded-full bg-[var(--a2soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--a2)]">
                                MANUAL
                              </span>
                            )}
                            {u.hasActiveJobs && (
                              <span className="rounded-full bg-[var(--a2soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--a2)]">
                                JOB
                              </span>
                            )}
                            <span
                              className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold ${
                                u.isOnline
                                  ? 'bg-[var(--a1soft)] text-[var(--a1)]'
                                  : 'bg-[var(--bg2)] text-[var(--ink3)]'
                              }`}
                            >
                              {u.isOnline ? 'ACTIVE' : 'AWAY'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Google Flow Projects (Admin Only) */}
                <div className="mb-3 p-3 rounded-[11px] bg-[var(--a1soft)] border border-[var(--a1)]/20 space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--a1)] font-semibold flex items-center gap-1.5">
                      <FolderKanban className="w-3.5 h-3.5 text-[var(--a1)]" />
                      Google Flow Projects (Admin Only)
                    </span>
                    <span className="text-[10px] font-mono text-[var(--ink3)]">
                      {(acc.flowProjects?.length ||
                        (Array.isArray(acc.flowProjectIds) ? acc.flowProjectIds.length : 0) ||
                        (acc.activeProjectId ? 1 : 0))}{' '}
                      project
                      {(acc.flowProjects?.length ||
                        (Array.isArray(acc.flowProjectIds) ? acc.flowProjectIds.length : 0) ||
                        (acc.activeProjectId ? 1 : 0)) === 1
                        ? ''
                        : 's'}
                    </span>
                  </div>

                  {(() => {
                    const projects =
                      acc.flowProjects && acc.flowProjects.length
                        ? acc.flowProjects
                        : Array.isArray(acc.flowProjectIds) && acc.flowProjectIds.length
                          ? acc.flowProjectIds.map((id) => ({
                              id,
                              url: `https://flow.google.com/project/${id}`,
                              assignedUser: null as {
                                id: string;
                                name: string | null;
                                email: string;
                              } | null,
                              usedBy: [] as { id: string; name: string | null; email: string }[],
                            }))
                          : acc.activeProjectId || acc.projectUrl
                            ? [
                                {
                                  id: acc.activeProjectId || 'linked',
                                  url:
                                    acc.projectUrl ||
                                    `https://flow.google.com/project/${acc.activeProjectId}`,
                                  assignedUser: null as {
                                    id: string;
                                    name: string | null;
                                    email: string;
                                  } | null,
                                  usedBy: [] as {
                                    id: string;
                                    name: string | null;
                                    email: string;
                                  }[],
                                },
                              ]
                            : [];

                    if (!projects.length) {
                      return (
                        <div className="flex items-center justify-between gap-2 bg-[var(--bg2)] p-2 rounded-lg border border-dashed border-[var(--line)]">
                          <span className="text-[11px] text-[var(--ink3)] italic">No Flow projects linked</span>
                          <button
                            type="button"
                            onClick={() => handleCreateProjectForAccount(acc.id)}
                            disabled={creatingProjectForId === acc.id}
                            className="text-[10px] px-2.5 py-1 rounded bg-[var(--a1soft)] hover:bg-[var(--a1soft)] text-[var(--a1)] border border-[var(--a1)]/30 font-semibold flex items-center gap-1 transition-all disabled:opacity-50"
                          >
                            <Sparkles className="w-3 h-3" />
                            <span>{creatingProjectForId === acc.id ? 'Creating...' : '+ Create Project'}</span>
                          </button>
                        </div>
                      );
                    }

                    return (
                      <div className="flex max-h-[280px] flex-col gap-1.5 overflow-y-auto">
                        {projects.map((proj) => {
                          const assigned = proj.assignedUser;
                          const using = proj.usedBy?.[0];
                          const extra = (proj.usedBy?.length || 0) - 1;
                          const showUser = using || assigned;
                          return (
                            <div
                              key={proj.id}
                              className="flex items-center justify-between gap-2 bg-[var(--bg)]/40 p-2 rounded-lg border border-[var(--line)]"
                            >
                              <div className="min-w-0 flex-1 space-y-0.5">
                                <a
                                  href={proj.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] text-[var(--a1)] hover:underline font-mono truncate flex items-center gap-1"
                                  title={proj.url}
                                >
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                  <span className="truncate">{proj.id.slice(0, 8)}…</span>
                                </a>
                                <p className="truncate text-[10px] text-[var(--ink3)]">
                                  {showUser ? (
                                    <>
                                      {using ? 'In use by' : 'Assigned'}:{' '}
                                      <span className="font-medium text-[var(--ink)]">
                                        {showUser.name || showUser.email.split('@')[0]}
                                      </span>
                                      <span className="font-mono"> ({showUser.email})</span>
                                      {extra > 0 ? ` +${extra}` : ''}
                                    </>
                                  ) : (
                                    <span className="italic">Unassigned · Idle</span>
                                  )}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                {using ? (
                                  <span className="rounded-full bg-[var(--a2soft)] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[var(--a2)]">
                                    BUSY
                                  </span>
                                ) : assigned ? (
                                  <span className="rounded-full bg-[var(--a1soft)] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-[var(--a1)]">
                                    SLOT
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-[var(--bg2)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--ink3)]">
                                    FREE
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleBibAction(acc.id, 'open_project', {
                                      projectId: proj.id,
                                      url: proj.url || `https://flow.google.com/project/${proj.id}`,
                                    })
                                  }
                                  disabled={bibBusyId === acc.id}
                                  className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 flex items-center gap-1 border border-emerald-500/30 disabled:opacity-50"
                                  title="Open BiB login stream on this Flow project"
                                >
                                  <Play className="w-2.5 h-2.5" />
                                  <span>{bibBusyId === acc.id ? '…' : 'Launch'}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCopyProjectUrl(acc.id + ':' + proj.id, proj.url)}
                                  className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg2)] hover:bg-[var(--bg2)] text-[var(--ink2)] flex items-center gap-1"
                                >
                                  {copiedId === acc.id + ':' + proj.id ? (
                                    <Check className="w-2.5 h-2.5 text-[var(--a1)]" />
                                  ) : (
                                    <Copy className="w-2.5 h-2.5" />
                                  )}
                                  <span>{copiedId === acc.id + ':' + proj.id ? 'Copied' : 'Copy'}</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  <p className="text-[10px] text-[var(--ink3)]">
                    Assigned users map 1:1 onto Flow projects. BUSY = generating on that slot right now.
                  </p>
                </div>

                {/* Metrics Breakdown */}
                <div className="space-y-2 p-3 rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--ink3)]">Google Credit Balance:</span>
                    <span className="font-bold text-[var(--a1)] font-mono text-sm">{acc.googleCreditsBalance} cr</span>
                  </div>

                  {/* Cookie Expiry Status */}
                  {(() => {
                    const exp = getCookieExpiryDisplay(acc.cookieExpiresAt);
                    return (
                      <div className="flex justify-between items-center">
                        <span className="text-[var(--ink3)]">Cookie Expiry:</span>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded flex items-center gap-1 ${
                            exp.status === 'expired'
                              ? 'bg-rose-500/15 text-rose-500'
                              : exp.status === 'warning'
                              ? 'bg-[var(--a2soft)] text-[var(--a2)]'
                              : 'bg-[var(--a1soft)] text-[var(--a1)]'
                          }`}
                        >
                          <Clock className="w-2.5 h-2.5" />
                          {exp.text}
                        </span>
                      </div>
                    );
                  })()}

                  <div className="flex justify-between">
                    <span className="text-[var(--ink3)]">Classification:</span>
                    <span
                      className={`font-semibold ${
                        acc.creditClassification === 'CREDITS_AVAILABLE' ? 'text-[var(--a1)]' : 'text-[var(--a2)]'
                      }`}
                    >
                      {acc.creditClassification === 'CREDITS_AVAILABLE' ? 'Funded (Pro Work)' : 'Exhausted (Zero-cost)'}
                    </span>
                  </div>

                  <div className="mt-2 rounded-lg border border-[var(--line)] bg-[var(--bg2)] px-2.5 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink3)]">
                          <Globe className="h-3 w-3" />
                          Account egress proxy
                        </p>
                        <p
                          className="mt-0.5 truncate font-mono text-[11px] text-[var(--ink)]"
                          title={acc.egressProxyUrl || ''}
                        >
                          {acc.egressProxyMasked || acc.egressProxyUrl || 'Unassigned (set on launch)'}
                        </p>
                        {(acc.egressIp || acc.egressCountry) && (
                          <p className="mt-0.5 text-[11px] text-[var(--ink3)]">
                            {[acc.egressIp, acc.egressCountry].filter(Boolean).join(' · ')}
                          </p>
                        )}
                        {lastProxyRotateAt ? (
                          <p className="mt-1 flex items-center gap-1 text-[10px] text-[var(--ink3)]">
                            <Clock className="h-3 w-3 shrink-0" />
                            Last rotate:{' '}
                            {new Date(lastProxyRotateAt).toLocaleString()}
                            {lastProxyRotateReason ? ` · ${lastProxyRotateReason}` : ''}
                          </p>
                        ) : null}
                        {rotateMsgById[acc.id] ? (
                          <p className="mt-1 text-[10px] text-[var(--a1)]">{rotateMsgById[acc.id]}</p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRotateProxy(acc.id)}
                        disabled={rotatingProxyId === acc.id || bibBusyId === acc.id}
                        className="shrink-0 flex items-center gap-1 rounded-lg border border-[var(--a1)]/30 bg-[var(--a1soft)] px-2 py-1 text-[11px] font-semibold text-[var(--a1)] disabled:opacity-50"
                        title="Rotate this account to next unique proxy and relaunch (keeps Google login)"
                      >
                        <RefreshCcw className={`h-3 w-3 ${rotatingProxyId === acc.id ? 'animate-spin' : ''}`} />
                        {rotatingProxyId === acc.id ? 'Rotating…' : 'Rotate'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card Footer Actions */}
              <div className="pt-3 border-t border-[var(--line)] flex flex-col gap-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => handleBibAction(acc.id, 'launch')}
                    disabled={bibBusyId === acc.id}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 text-xs font-semibold border border-emerald-500/30 disabled:opacity-50"
                    title="Launch persistent Chrome for BiB login"
                  >
                    <Play className="w-3 h-3" />
                    <span>{bibBusyId === acc.id ? '…' : 'Launch'}</span>
                  </button>
                  <button
                    onClick={async () => {
                      const data = await handleBibAction(acc.id, 'sync_status');
                      if (data?.viewerUrl) {
                        setBibViewer({ id: acc.id, url: data.viewerUrl, label: acc.label });
                      }
                    }}
                    disabled={bibBusyId === acc.id}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-500/15 text-sky-600 text-xs font-semibold border border-sky-500/30 disabled:opacity-50"
                  >
                    <MonitorPlay className="w-3 h-3" />
                    <span>Login stream</span>
                  </button>
                  <button
                    onClick={() => handleBibAction(acc.id, 'ensure_projects')}
                    disabled={bibBusyId === acc.id}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--a1soft)] text-[var(--a1)] text-xs font-semibold border border-[var(--a1)]/20 disabled:opacity-50"
                    title="Fetch Flow project IDs from flow.google.com (create only if short)"
                  >
                    <FolderKanban className="w-3 h-3" />
                    <span>Fetch projects</span>
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Disconnect browser for ${acc.label}?`)) {
                        handleBibAction(acc.id, 'disconnect');
                      }
                    }}
                    disabled={bibBusyId === acc.id}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-500 text-xs font-semibold border border-rose-500/20 disabled:opacity-50"
                  >
                    <Unplug className="w-3 h-3" />
                    <span>Disconnect</span>
                  </button>
                  <span
                    className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded border ${
                      acc.browserStatus === 'READY'
                        ? 'border-emerald-500/40 text-emerald-600'
                        : acc.browserStatus === 'NEEDS_LOGIN'
                          ? 'border-amber-500/40 text-amber-600'
                          : 'border-[var(--line)] text-[var(--ink3)]'
                    }`}
                  >
                    BiB: {acc.browserStatus || 'STOPPED'}
                    {Array.isArray(acc.flowProjectIds) ? ` · ${acc.flowProjectIds.length} proj` : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleRefreshAccount(acc.id)}
                    disabled={isRefreshing}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--a1soft)] hover:bg-[var(--a1soft)] text-[var(--a1)] text-xs font-semibold transition-all border border-[var(--a1)]/20 disabled:opacity-50"
                    title="Refresh BiB status, plan and credits"
                  >
                    <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                    <span>{isRefreshing ? 'Probing...' : 'Refresh Live'}</span>
                  </button>

                  <button
                    onClick={() => handleOpenEdit(acc)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[var(--bg2)] hover:bg-[var(--bg2)] text-[var(--ink)] text-xs font-semibold transition-all border border-[var(--line)]"
                    title="Update plan, project URL and slots"
                  >
                    <Edit3 className="w-3 h-3 text-[var(--a1)]" />
                    <span>Update</span>
                  </button>
                </div>

                <button
                  onClick={() => handleDeleteAccount(acc.id, acc.label)}
                  className="p-1 rounded-lg text-[var(--ink3)] hover:text-rose-500 hover:bg-rose-500/10 transition-all"
                  title="Delete Account from Pool"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ADD ACCOUNT MODAL — BiB first */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--bg)]/80 backdrop-blur-sm animate-in fade-in">
          <div className="p-6 sm:p-8 rounded-[18px] border border-[var(--line)] bg-[var(--card)] max-w-lg w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-lg font-bold text-[var(--ink)] flex items-center gap-2">
                <MonitorPlay className="w-5 h-5 text-[var(--a1)]" />
                Connect Google Account (BiB)
              </h3>
              <p className="text-xs text-[var(--ink3)] mt-1">
                No cookie paste. We launch a browser on the server — you sign in once, then we create Flow projects for parallel slots.
              </p>
            </div>

            <ol className="rounded-[11px] border border-[var(--a1)]/25 bg-[var(--a1soft)] p-3 space-y-1.5 text-[11px] text-[var(--ink2)] list-decimal list-inside">
              <li>
                <span className="font-semibold text-[var(--ink)]">Save</span> this account shell
              </li>
              <li>
                <span className="font-semibold text-[var(--ink)]">Launch</span> opens the login stream automatically
              </li>
              <li>
                Sign into Google inside the stream, then{' '}
                <span className="font-semibold text-[var(--ink)]">Ensure projects</span> (= max slots)
              </li>
            </ol>

            <form onSubmit={handleAddAccount} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink2)] mb-1.5">
                  Account Label
                </label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Ultra Cluster A"
                  className="w-full px-3.5 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] placeholder:text-[var(--ink3)] text-xs focus:outline-none focus:border-[var(--a1)]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink2)] mb-1.5">
                  Google Email <span className="normal-case font-normal text-[var(--ink3)]">(optional — filled after login)</span>
                </label>
                <input
                  type="email"
                  value={accountEmail}
                  onChange={(e) => setAccountEmail(e.target.value)}
                  placeholder="name@gmail.com"
                  className="w-full px-3.5 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] placeholder:text-[var(--ink3)] text-xs focus:outline-none focus:border-[var(--a1)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink2)] mb-1.5">
                    Plan Tier
                  </label>
                  <select
                    value={planTier}
                    onChange={(e) => setPlanTier(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] text-xs focus:outline-none focus:border-[var(--a1)]"
                  >
                    <option value="Google AI Ultra">Google AI Ultra (5,000 cr)</option>
                    <option value="Google AI Pro">Google AI Pro (1,000 cr)</option>
                    <option value="Google AI Tier 1">Google AI Tier 1 (500 cr)</option>
                    <option value="Free Tier">Free Tier (0 cr)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--a1)] mb-1.5">
                    Parallel slots
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={maxParallelLimit}
                    onChange={(e) => setMaxParallelLimit(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-[11px] bg-[var(--a1soft)] border border-[var(--a1)]/30 text-[var(--ink)] text-xs focus:outline-none font-mono font-bold"
                  />
                  <p className="text-[10px] text-[var(--ink3)] mt-1">
                    = number of Flow projects to fetch/create for parallel gens + max users on this account.
                  </p>
                </div>
              </div>

              <div className="rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2.5 text-[11px] text-[var(--ink3)]">
                After Save & Launch, sign into <span className="text-[var(--ink2)]">flow.google.com</span> inside the BiB
                stream. Cookies and session tokens are fetched live from BiB — no paste needed.
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ink3)] mb-1">
                  Optional single project URL
                </label>
                <input
                  type="text"
                  value={projectUrl}
                  onChange={(e) => setProjectUrl(e.target.value)}
                  placeholder="Usually leave empty — BiB creates N projects from slots"
                  className="w-full px-3 py-2 rounded-[11px] bg-[var(--bg)] border border-[var(--line)] text-[var(--ink)] placeholder:text-[var(--ink3)] text-xs font-mono focus:outline-none focus:border-[var(--a1)]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                  }}
                  className="btn-secondary !px-4 !py-2 !text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || bibBusyId !== null}
                  className="btn-primary !px-5 !py-2.5 !text-xs disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  {submitting || bibBusyId
                    ? 'Saving & launching…'
                    : 'Save & Launch Login'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT ACCOUNT MODAL */}
      {showEditModal && editingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--bg)]/80 backdrop-blur-sm animate-in fade-in">
          <div className="p-6 sm:p-8 rounded-[18px] border border-[var(--line)] bg-[var(--card)] max-w-lg w-full shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-lg font-bold text-[var(--ink)] flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-[var(--a1)]" />
                Update Provider Account
              </h3>
              <p className="text-xs text-[var(--ink3)] mt-1">
                Updating <span className="text-[var(--a1)] font-semibold">{editingAccount.label}</span> ({editingAccount.accountEmail}).
              </p>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink2)] mb-1.5">
                    Account Plan Tier
                  </label>
                  <select
                    value={editPlanTier}
                    onChange={(e) => setEditPlanTier(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] text-xs focus:outline-none focus:border-[var(--a1)]"
                  >
                    <option value="Google AI Ultra">Google AI Ultra (5,000 cr)</option>
                    <option value="Google AI Pro">Google AI Pro (1,000 cr)</option>
                    <option value="Google AI Tier 1">Google AI Tier 1 (500 cr)</option>
                    <option value="Free Tier">Free Tier (0 cr)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--a1)] mb-1.5 flex items-center justify-between">
                    <span>User Allocation Capacity</span>
                    <span className="text-[10px] text-[var(--ink3)] normal-case font-normal">(Max Parallel)</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    required
                    value={editMaxParallelLimit}
                    onChange={(e) => setEditMaxParallelLimit(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-[11px] bg-[var(--a1soft)] border border-[var(--a1)]/30 text-[var(--ink)] text-xs font-mono focus:outline-none focus:border-[var(--a1)] font-bold"
                  />
                  <p className="text-[10px] text-[var(--ink3)] mt-1">Concurrent user slots allowed on this account.</p>
                </div>
              </div>

              {/* Dedicated Google Flow Project URL Input */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--ink2)]">
                    Google Flow Project URL (Admin Only)
                  </label>
                  <button
                    type="button"
                    onClick={() => handleCreateProjectForAccount(editingAccount.id)}
                    disabled={creatingProjectForId === editingAccount.id}
                    className="text-[11px] px-2 py-0.5 rounded bg-[var(--a1soft)] hover:bg-[var(--a1soft)] text-[var(--a1)] border border-[var(--a1)]/30 font-semibold flex items-center gap-1 transition-all disabled:opacity-50"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>{creatingProjectForId === editingAccount.id ? 'Creating Project...' : '+ Create New Project'}</span>
                  </button>
                </div>
                <input
                  type="text"
                  value={editProjectUrl}
                  onChange={(e) => setEditProjectUrl(e.target.value)}
                  placeholder="https://flow.google.com/project/..."
                  className="w-full px-3.5 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] placeholder:text-[var(--ink3)] text-xs font-mono focus:outline-none focus:border-[var(--a1)]"
                />
                <p className="text-[11px] text-[var(--ink3)] mt-1">
                  Generations for this account route here. Prefer BiB Ensure projects over manual URLs.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="btn-secondary !px-4 !py-2 !text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary !px-5 !py-2.5 !text-xs disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save Updates'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {bibViewer && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-[var(--bg)]/85 backdrop-blur-sm">
          <div className="w-full max-w-5xl rounded-[18px] border border-[var(--line)] bg-[var(--card)] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--line)]">
              <div>
                <h3 className="text-sm font-bold text-[var(--ink)]">BiB Login — {bibViewer.label}</h3>
                <p className="text-[11px] text-[var(--ink3)]">
                  Exit IP and country show in the stream toolbar (top). Restart BiB after changing
                  proxies so Chrome picks them up.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary !px-3 !py-1.5 !text-xs"
                  onClick={() => handleBibAction(bibViewer.id, 'ensure_projects')}
                >
                  Fetch projects
                </button>
                <button
                  type="button"
                  className="btn-secondary !px-3 !py-1.5 !text-xs"
                  onClick={() => handleBibAction(bibViewer.id, 'sync_status')}
                >
                  Sync status
                </button>
                <button
                  type="button"
                  className="btn-primary !px-3 !py-1.5 !text-xs"
                  onClick={() => setBibViewer(null)}
                >
                  Close
                </button>
              </div>
            </div>
            <iframe
              title="BiB viewer"
              src={bibViewer.url}
              className="w-full flex-1 min-h-[70vh] bg-black border-0"
            />
          </div>
        </div>
      )}
    </div>
  );
}
