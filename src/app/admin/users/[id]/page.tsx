'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  User,
  Mail,
  Shield,
  Lock,
  Unlock,
  Key,
  Globe,
  Coins,
  CreditCard,
  Server,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Video,
  Image as ImageIcon,
  Save,
  AlertTriangle,
  Sparkles,
  Layers,
  Filter,
  Play,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  RefreshCw,
  Eye,
  EyeOff,
} from 'lucide-react';
import { formatModelDisplayName } from '@/lib/modelLabels';

interface GenerationJobItem {
  id: string;
  modelKey: string;
  creditCost: number;
  walletType: string;
  status: string;
  progress: number;
  prompt: string;
  parameters?: any;
  outputMediaUrl?: string | null;
  errorMessage?: string | null;
  submittedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
}

interface UserDetail {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  isLocked: boolean;
  lastIp: string;
  createdAt: string;
  updatedAt: string;
  plan: string;
  maxParallel: number;
  displayPrice?: number | null;
  isCustomDeal?: boolean;
  periodDays?: number | null;
  periodEnd?: string | null;
  wallets: {
    standard: { available: number; total: number; reserved: number };
    pro: { available: number; total: number; reserved: number };
  };
  assignedProviderAccount: {
    id: string;
    label: string;
    accountEmail: string;
    status: string;
    googleCreditsBalance: number;
  } | null;
  providerAssignmentManual?: boolean;
  stats: {
    totalJobs: number;
    successfulJobs: number;
    failedJobs: number;
    totalCreditsSpent: number;
    videoJobs: number;
    imageJobs: number;
    totalProjects: number;
  };
  recentJobs: GenerationJobItem[];
  transactions: Array<{
    id: string;
    walletType: string;
    type: string;
    amount: number;
    balanceAfter: number;
    reason: string | null;
    createdAt: string;
  }>;
  orders: Array<{
    id: string;
    amount: number;
    currency: string;
    gateway: string;
    status: string;
    createdAt: string;
    plan: { name: string };
  }>;
}

interface ProviderAccountOption {
  id: string;
  label: string;
  accountEmail: string;
  status: string;
  googleCreditsBalance: number;
}

interface PlanOption {
  id: string;
  name: string;
  maxParallel: number;
  priceMonthly: number;
  standardCreditsCycle: number;
  proCreditsCycle: number;
}

export default function AdminUserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params?.id as string;

  const [user, setUser] = useState<UserDetail | null>(null);
  const [providerAccounts, setProviderAccounts] = useState<ProviderAccountOption[]>([]);
  const [availablePlans, setAvailablePlans] = useState<PlanOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [savingAccount, setSavingAccount] = useState(false);

  // Modals
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswordText, setShowPasswordText] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditWallet, setCreditWallet] = useState<'STANDARD' | 'PRO'>('STANDARD');
  const [creditDelta, setCreditDelta] = useState<number>(50);
  const [creditReason, setCreditReason] = useState('Admin manual credit grant');
  const [creditLoading, setCreditLoading] = useState(false);

  const [showPlanModal, setShowPlanModal] = useState(false);
  const [selectedPlanName, setSelectedPlanName] = useState('Pro');
  const [planReason, setPlanReason] = useState('Admin discretionary adjustment');
  const [planLoading, setPlanLoading] = useState(false);
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [renewLoading, setRenewLoading] = useState(false);
  const [renewForm, setRenewForm] = useState({
    days: 30,
    standardCredits: 0,
    proCredits: 0,
    maxParallel: 1,
    displayPrice: 0,
    reason: 'Admin renew custom deal',
  });

  // Media preview modal
  const [previewMedia, setPreviewMedia] = useState<{ url: string; type: 'video' | 'image'; prompt?: string } | null>(null);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'generations' | 'credits' | 'plan' | 'settings' | 'studio-logs'>('generations');

  // Generation filter
  const [genTypeFilter, setGenTypeFilter] = useState<'all' | 'video' | 'image'>('all');
  const [genStatusFilter, setGenStatusFilter] = useState<'all' | 'COMPLETED' | 'FAILED' | 'IN_QUEUE'>('all');

  // Studio logs (admin view for this user)
  const [studioLogs, setStudioLogs] = useState<Array<{
    id: string;
    level: string;
    message: string;
    source: string;
    flowEmail: string | null;
    userEmail: string | null;
    createdAt: string;
  }>>([]);
  const [studioLogsLoading, setStudioLogsLoading] = useState(false);
  const [studioLogLevel, setStudioLogLevel] = useState('ALL');
  const [studioLogQ, setStudioLogQ] = useState('');

  const fetchStudioLogs = async () => {
    if (!userId) return;
    setStudioLogsLoading(true);
    try {
      const params = new URLSearchParams({ userId, limit: '100' });
      if (studioLogLevel !== 'ALL') params.set('level', studioLogLevel);
      if (studioLogQ.trim()) params.set('q', studioLogQ.trim());
      const res = await fetch(`/api/admin/studio-logs?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setStudioLogs(data.logs || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setStudioLogsLoading(false);
    }
  };

  const fetchUser = async () => {
    try {
      const res = await fetch(`/api/admin/users/${userId}`);
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setProviderAccounts(data.availableProviderAccounts || []);
        setAvailablePlans(data.availablePlans || []);
        setSelectedAccountId(data.user.assignedProviderAccount?.id || '');
        setSelectedPlanName(data.user.plan || 'Free');
      } else {
        router.push('/admin/users');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (userId) fetchUser();
  }, [userId]);

  useEffect(() => {
    if (activeTab === 'studio-logs' && userId) fetchStudioLogs();
  }, [activeTab, userId, studioLogLevel]);

  // Lock / Unlock Toggle
  const handleToggleLock = async () => {
    if (!user) return;
    const action = user.isLocked ? 'unlock' : 'lock';
    if (!confirm(`Are you sure you want to ${action} user ${user.email}?`)) return;

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isLocked: !user.isLocked }),
      });
      if (res.ok) {
        fetchUser();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Change Password
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword.trim() || newPassword.length < 6) {
      setPasswordFeedback({ type: 'error', text: 'Password must be at least 6 characters long.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ type: 'error', text: 'Passwords do not match.' });
      return;
    }

    setPasswordLoading(true);
    setPasswordFeedback(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: newPassword.trim() }),
      });
      if (res.ok) {
        setPasswordFeedback({ type: 'success', text: 'Password successfully updated for user!' });
        setTimeout(() => {
          setShowPasswordModal(false);
          setNewPassword('');
          setConfirmPassword('');
          setPasswordFeedback(null);
        }, 1200);
      } else {
        const err = await res.json();
        setPasswordFeedback({ type: 'error', text: err.error || 'Failed to update password' });
      }
    } catch (err: any) {
      setPasswordFeedback({ type: 'error', text: err.message || 'Error updating password' });
    } finally {
      setPasswordLoading(false);
    }
  };

  // Save Assigned Provider Account
  const handleSaveAssignedAccount = async () => {
    setSavingAccount(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedProviderAccountId: selectedAccountId || null }),
      });
      if (res.ok) {
        fetchUser();
        alert(
          selectedAccountId
            ? 'Manual account pin saved — it will not change until you set Automatic.'
            : 'Switched to Automatic — user was reallocated to a free account.'
        );
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingAccount(false);
    }
  };

  // Adjust Credits
  const handleAdjustCredits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creditReason.trim()) return;
    setCreditLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletType: creditWallet,
          delta: creditDelta,
          reason: creditReason.trim(),
        }),
      });
      if (res.ok) {
        setShowCreditModal(false);
        setCreditReason('Admin manual credit grant');
        fetchUser();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to adjust credits');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCreditLoading(false);
    }
  };

  // Update Plan
  const handleUpdatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    setPlanLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planName: selectedPlanName,
          reason: planReason.trim(),
        }),
      });
      if (res.ok) {
        setShowPlanModal(false);
        fetchUser();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to update plan');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setPlanLoading(false);
    }
  };

  const handleRenewDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    setRenewLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(renewForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Renew failed');
      setShowRenewModal(false);
      fetchUser();
    } catch (err: any) {
      alert(err.message || 'Renew failed');
    } finally {
      setRenewLoading(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-[400px] text-[var(--ink3)] text-xs">
        <Activity className="w-5 h-5 animate-spin text-[var(--a1)] mr-2" />
        Loading User Diagnostics & Analytics...
      </div>
    );
  }

  // Filtered Generations
  const filteredJobs = user.recentJobs.filter((j) => {
    const isVid = (j.modelKey || '').toLowerCase().includes('veo') || (j.modelKey || '').toLowerCase().includes('video');
    if (genTypeFilter === 'video' && !isVid) return false;
    if (genTypeFilter === 'image' && isVid) return false;
    if (genStatusFilter !== 'all' && j.status !== genStatusFilter) return false;
    return true;
  });

  const successRate = user.stats.totalJobs > 0 
    ? Math.round((user.stats.successfulJobs / user.stats.totalJobs) * 100) 
    : 100;

  return (
    <div className="flex flex-col gap-5">
      {/* Top Header & Breadcrumbs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/users"
            className="p-2.5 rounded-[11px] bg-[var(--bg2)] hover:bg-[var(--bg2)] text-[var(--ink2)] hover:text-[var(--ink)] transition-all border border-[var(--line)]"
            title="Back to User List"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-[var(--ink)] tracking-tight">{user.name || 'Anonymous User'}</h1>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  user.isLocked
                    ? 'bg-rose-500/15 text-rose-500 border border-rose-500/30'
                    : 'bg-[var(--a1soft)] text-[var(--a1)] border border-[var(--a1)]/30'
                }`}
              >
                {user.isLocked ? 'LOCKED' : 'ACTIVE'}
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[var(--a1soft)] text-[var(--a1)] border border-[var(--a1)]/30">
                {user.plan} Plan ({user.maxParallel} slots)
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[var(--a1soft)] text-[var(--a1)] border border-[var(--a1)]/30 font-mono">
                {user.role}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 text-xs text-[var(--ink3)] mt-1">
              <span className="flex items-center gap-1 font-mono text-[var(--ink2)]">
                <Mail className="w-3 h-3 text-[var(--ink3)]" />
                {user.email}
              </span>
              <span className="text-[var(--ink3)]">&bull;</span>
              <span className="flex items-center gap-1 font-mono text-[var(--a1)]">
                <Globe className="w-3 h-3 text-[var(--a1)]" />
                IP: {user.lastIp}
              </span>
              <span className="text-[var(--ink3)]">&bull;</span>
              <span>Joined {new Date(user.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        </div>

        {/* Top Control Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPasswordModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-[11px] bg-[var(--a2soft)] hover:bg-[var(--a2soft)] text-[var(--a2)] border border-[var(--a2)]/20 font-semibold text-xs transition-all "
          >
            <Key className="w-3.5 h-3.5" />
            <span>Change Password</span>
          </button>
          <button
            onClick={() => setShowCreditModal(true)}
            className="btn-primary !px-3 !py-2 !text-xs"
          >
            <Coins className="w-3.5 h-3.5" />
            <span>Adjust Credits</span>
          </button>
          <button
            onClick={() => setShowPlanModal(true)}
            className="btn-primary !px-3 !py-2 !text-xs"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Change Plan</span>
          </button>
          <button
            onClick={handleToggleLock}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-[11px] text-xs font-semibold transition-all border ${
              user.isLocked
                ? 'bg-[var(--a1soft)] text-[var(--a1)] border-[var(--a1)]/30 hover:bg-[var(--a1soft)]'
                : 'bg-rose-500/15 text-rose-500 border-rose-500/30 hover:bg-rose-500/20'
            }`}
          >
            {user.isLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            <span>{user.isLocked ? 'Unlock Account' : 'Lock Account'}</span>
          </button>
        </div>
      </div>

      {/* 1. USER ANALYTICS KPI OVERVIEW */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="p-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] hover:border-[var(--line)] transition-all">
          <div className="text-[11px] font-semibold uppercase text-[var(--ink3)] mb-1">Total Generat.</div>
          <div className="text-2xl font-bold text-[var(--ink)] font-mono">{user.stats.totalJobs}</div>
          <div className="text-[10px] text-[var(--a1)] mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            {user.stats.successfulJobs} completed
          </div>
        </div>

        <div className="p-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] hover:border-[var(--line)] transition-all">
          <div className="text-[11px] font-semibold uppercase text-[var(--a1)] mb-1">Success Rate</div>
          <div className="text-2xl font-bold text-[var(--a1)] font-mono">{successRate}%</div>
          <div className="text-[10px] text-[var(--ink3)] mt-1">{user.stats.failedJobs} failed jobs</div>
        </div>

        <div className="p-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] hover:border-[var(--line)] transition-all">
          <div className="text-[11px] font-semibold uppercase text-[var(--a2)] mb-1">Credits Spent</div>
          <div className="text-2xl font-bold text-[var(--a2)] font-mono">{user.stats.totalCreditsSpent}</div>
          <div className="text-[10px] text-[var(--ink3)] mt-1">Total model usage</div>
        </div>

        <div className="p-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] hover:border-[var(--line)] transition-all">
          <div className="text-[11px] font-semibold uppercase text-[var(--a1)] mb-1">Standard Balance</div>
          <div className="text-2xl font-bold text-[var(--a1)] font-mono">{user.wallets.standard.available}</div>
          <div className="text-[10px] text-[var(--ink3)] mt-1">{user.wallets.standard.reserved} reserved</div>
        </div>

        <div className="p-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] hover:border-[var(--line)] transition-all">
          <div className="text-[11px] font-semibold uppercase text-[var(--a1)] mb-1">Pro Balance</div>
          <div className="text-2xl font-bold text-[var(--a1)] font-mono">{user.wallets.pro.available}</div>
          <div className="text-[10px] text-[var(--ink3)] mt-1">{user.wallets.pro.reserved} reserved</div>
        </div>

        <div className="p-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] hover:border-[var(--line)] transition-all">
          <div className="text-[11px] font-semibold uppercase text-[var(--a1)] mb-1">Media Split</div>
          <div className="text-base font-bold text-[var(--ink)] flex items-center gap-1.5 mt-1">
            <span className="text-[var(--a1)] font-mono">{user.stats.videoJobs} videos</span>
            <span className="text-[var(--ink3)]">/</span>
            <span className="text-[var(--a1)] font-mono">{user.stats.imageJobs} imgs</span>
          </div>
          <div className="text-[10px] text-[var(--ink3)] mt-1">{user.stats.totalProjects} projects owned</div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-[var(--line)] pb-3">
        <button
          onClick={() => setActiveTab('generations')}
          className={`flex items-center gap-2 px-4 py-2 rounded-[11px] text-xs font-semibold transition-all ${
            activeTab === 'generations'
              ? 'bg-[var(--a1soft)] text-[var(--a1)] '
              : 'text-[var(--ink3)] hover:text-[var(--ink)] hover:bg-[var(--bg2)]'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Generations Analytics ({user.recentJobs.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('credits')}
          className={`flex items-center gap-2 px-4 py-2 rounded-[11px] text-xs font-semibold transition-all ${
            activeTab === 'credits'
              ? 'bg-[var(--a1soft)] text-[var(--a1)] '
              : 'text-[var(--ink3)] hover:text-[var(--ink)] hover:bg-[var(--bg2)]'
          }`}
        >
          <Coins className="w-3.5 h-3.5" />
          <span>Credit & Wallet History ({user.transactions.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('plan')}
          className={`flex items-center gap-2 px-4 py-2 rounded-[11px] text-xs font-semibold transition-all ${
            activeTab === 'plan'
              ? 'bg-[var(--a1soft)] text-[var(--a1)] '
              : 'text-[var(--ink3)] hover:text-[var(--ink)] hover:bg-[var(--bg2)]'
          }`}
        >
          <CreditCard className="w-3.5 h-3.5" />
          <span>Plan & Subscription History ({user.orders.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`flex items-center gap-2 px-4 py-2 rounded-[11px] text-xs font-semibold transition-all ${
            activeTab === 'settings'
              ? 'bg-[var(--a1soft)] text-[var(--a1)]'
              : 'text-[var(--ink3)] hover:text-[var(--ink)] hover:bg-[var(--bg2)]'
          }`}
        >
          <Server className="w-3.5 h-3.5" />
          <span>Provider & Security</span>
        </button>

        <button
          onClick={() => setActiveTab('studio-logs')}
          className={`flex items-center gap-2 px-4 py-2 rounded-[11px] text-xs font-semibold transition-all ${
            activeTab === 'studio-logs'
              ? 'bg-[var(--a1soft)] text-[var(--a1)]'
              : 'text-[var(--ink3)] hover:text-[var(--ink)] hover:bg-[var(--bg2)]'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Studio Logs</span>
        </button>
      </div>

      {/* TAB 1: GENERATIONS ANALYTICS */}
      {activeTab === 'generations' && (
        <div className="space-y-4">
          {/* Generation Filters */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-[18px] border border-[var(--line)] bg-[var(--card)]">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--ink3)] flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-[var(--a1)]" />
                Type:
              </span>
              {(['all', 'video', 'image'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setGenTypeFilter(t)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-all ${
                    genTypeFilter === t
                      ? 'bg-[var(--a1soft)] text-[var(--a1)] border border-[var(--a1)]/30'
                      : 'text-[var(--ink3)] hover:text-[var(--ink)] hover:bg-[var(--bg2)]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--ink3)]">Status:</span>
              {(['all', 'COMPLETED', 'FAILED', 'IN_QUEUE'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setGenStatusFilter(s)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                    genStatusFilter === s
                      ? 'bg-[var(--a1soft)] text-[var(--a1)] border border-[var(--a1)]/30'
                      : 'text-[var(--ink3)] hover:text-[var(--ink)] hover:bg-[var(--bg2)]'
                  }`}
                >
                  {s === 'all' ? 'All' : s}
                </button>
              ))}
            </div>
          </div>

          {/* Generations Table */}
          <div className="rounded-[18px] border border-[var(--line)] bg-[var(--card)] overflow-hidden">
            {filteredJobs.length === 0 ? (
              <div className="py-16 text-center text-[var(--ink3)] text-xs">
                No generations match the selected filter.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)] border-b border-[var(--line)]">
                    <tr>
                      <th className="px-4 py-3">Media / Preview</th>
                      <th className="px-4 py-3">Prompt</th>
                      <th className="px-4 py-3">Model</th>
                      <th className="px-4 py-3">Cost & Wallet</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredJobs.map((j) => {
                      const isVid = (j.modelKey || '').toLowerCase().includes('veo') || (j.modelKey || '').toLowerCase().includes('video');

                      return (
                        <tr key={j.id} className="border-t border-[var(--line)] hover:bg-[var(--bg2)]/50">
                          {/* Media Preview Column */}
                          <td className="px-4 py-3">
                            {j.outputMediaUrl ? (
                              <div
                                onClick={() =>
                                  setPreviewMedia({
                                    url: j.outputMediaUrl!,
                                    type: isVid ? 'video' : 'image',
                                    prompt: j.prompt,
                                  })
                                }
                                className="relative w-16 h-10 rounded-lg overflow-hidden bg-[var(--bg2)] border border-[var(--line)] cursor-pointer group flex items-center justify-center hover:border-[var(--a1)] transition-all"
                              >
                                {isVid ? (
                                  <>
                                    <video src={j.outputMediaUrl} className="w-full h-full object-cover" muted />
                                    <div className="absolute inset-0 bg-[var(--bg)]/40 flex items-center justify-center group-hover:bg-[var(--a1soft)] transition-all">
                                      <Play className="w-3.5 h-3.5 text-[var(--ink)]" />
                                    </div>
                                  </>
                                ) : (
                                  <img src={j.outputMediaUrl} alt="Preview" className="w-full h-full object-cover" />
                                )}
                              </div>
                            ) : (
                              <div className="flex h-10 w-16 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--bg2)] text-[var(--ink3)]">
                                {isVid ? <Video className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
                              </div>
                            )}
                          </td>

                          {/* Prompt */}
                          <td className="px-4 py-3 max-w-sm">
                            <div className="text-[var(--ink)] line-clamp-2" title={j.prompt}>
                              &ldquo;{j.prompt}&rdquo;
                            </div>
                            {j.errorMessage && (
                              <div className="text-rose-500 text-[10px] mt-1 font-mono line-clamp-1" title={j.errorMessage}>
                                Error: {j.errorMessage}
                              </div>
                            )}
                          </td>

                          {/* Model */}
                          <td className="px-4 py-3">
                            <span className="text-[var(--a1)] font-semibold px-2 py-0.5 rounded bg-[var(--a1soft)] text-[10px]">
                              {formatModelDisplayName(
                                j.modelKey,
                                (j.modelKey || '').toLowerCase().includes('veo') ||
                                  (j.modelKey || '').toLowerCase().includes('omni')
                                  ? 'video'
                                  : 'image'
                              )}
                            </span>
                          </td>

                          {/* Cost */}
                          <td className="px-4 py-3 font-mono">
                            <span className="text-[var(--ink)] font-bold">{j.creditCost}</span>{' '}
                            <span className={`text-[10px] font-semibold ${j.walletType === 'PRO' ? 'text-[var(--a1)]' : 'text-[var(--a1)]'}`}>
                              {j.walletType}
                            </span>
                          </td>

                          {/* Status */}
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                j.status === 'COMPLETED'
                                  ? 'bg-[var(--a1soft)] text-[var(--a1)] border border-[var(--a1)]/30'
                                  : j.status === 'FAILED'
                                  ? 'bg-rose-500/15 text-rose-500 border border-rose-500/30'
                                  : 'bg-[var(--a2soft)] text-[var(--a2)] border border-[var(--a2)]/30'
                              }`}
                            >
                              {j.status}
                            </span>
                          </td>

                          {/* Timestamp */}
                          <td className="px-4 py-3 text-[var(--ink3)] whitespace-nowrap text-[11px]">
                            {new Date(j.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: CREDIT & WALLET HISTORY */}
      {activeTab === 'credits' && (
        <div className="space-y-6">
          {/* Wallets Summary Card */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-[18px] border border-[var(--line)] bg-[var(--card)] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-[var(--a1)]">Standard Wallet (Lite Models)</span>
                <button
                  onClick={() => {
                    setCreditWallet('STANDARD');
                    setShowCreditModal(true);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-[var(--a1soft)] hover:bg-[var(--a1soft)] text-[var(--a1)] text-xs font-semibold transition-all"
                >
                  + Adjust Standard
                </button>
              </div>
              <div className="text-3xl font-extrabold text-[var(--ink)] font-mono">{user.wallets.standard.available} cr</div>
              <div className="text-xs text-[var(--ink3)] flex items-center gap-3 pt-1">
                <span>Total: {user.wallets.standard.total}</span>
                <span>&bull;</span>
                <span>Locked/Reserved: {user.wallets.standard.reserved}</span>
              </div>
            </div>

            <div className="p-5 rounded-[18px] border border-[var(--line)] bg-[var(--card)] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-[var(--a1)]">Pro Wallet (Veo 3.1 & Omni)</span>
                <button
                  onClick={() => {
                    setCreditWallet('PRO');
                    setShowCreditModal(true);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-[var(--a1soft)] hover:bg-[var(--a1soft)] text-[var(--a1)] text-xs font-semibold transition-all"
                >
                  + Adjust Pro
                </button>
              </div>
              <div className="text-3xl font-extrabold text-[var(--ink)] font-mono">{user.wallets.pro.available} cr</div>
              <div className="text-xs text-[var(--ink3)] flex items-center gap-3 pt-1">
                <span>Total: {user.wallets.pro.total}</span>
                <span>&bull;</span>
                <span>Locked/Reserved: {user.wallets.pro.reserved}</span>
              </div>
            </div>
          </div>

          {/* Credit Ledger Table */}
          <div className="rounded-[18px] border border-[var(--line)] bg-[var(--card)] overflow-hidden">
            <div className="p-4 border-b border-[var(--line)] flex items-center justify-between">
              <h3 className="font-bold text-[var(--ink)] text-xs uppercase tracking-wider">Credit Ledger Audit Trail</h3>
              <span className="text-[11px] text-[var(--ink3)] font-mono">{user.transactions.length} entries recorded</span>
            </div>
            {user.transactions.length === 0 ? (
              <div className="py-16 text-center text-[var(--ink3)] text-xs">No credit ledger entries recorded yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)] border-b border-[var(--line)]">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Wallet</th>
                      <th className="px-4 py-3">Operation</th>
                      <th className="px-4 py-3">Delta</th>
                      <th className="px-4 py-3">Balance After</th>
                      <th className="px-4 py-3">Reason / Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {user.transactions.map((tx) => (
                      <tr key={tx.id} className="border-t border-[var(--line)] hover:bg-[var(--bg2)]/50">
                        <td className="px-4 py-3 text-[var(--ink3)] whitespace-nowrap">
                          {new Date(tx.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              tx.walletType === 'PRO' ? 'bg-[var(--a1soft)] text-[var(--a1)]' : 'bg-[var(--a1soft)] text-[var(--a1)]'
                            }`}
                          >
                            {tx.walletType}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[var(--ink2)]">{tx.type}</td>
                        <td className="px-4 py-3 font-mono font-bold">
                          <span className={tx.amount >= 0 ? 'text-[var(--a1)]' : 'text-rose-500'}>
                            {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[var(--ink2)]">{tx.balanceAfter}</td>
                        <td className="px-4 py-3 text-[var(--ink3)] max-w-xs truncate">{tx.reason || 'Manual Adjustment'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: PLAN & SUBSCRIPTION HISTORY */}
      {activeTab === 'plan' && (
        <div className="space-y-6">
          {/* Plan Summary Card */}
          <div className="p-6 rounded-[18px] border border-[var(--line)] bg-[var(--card)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-[var(--ink)] text-base">Current Tier: {user.plan}</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--a1soft)] text-[var(--a1)] border border-[var(--a1)]/30">
                  {user.maxParallel} Parallel Generation Slots
                </span>
                {user.isCustomDeal && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--bg2)] text-[var(--ink2)]">
                    CUSTOM DEAL
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--ink3)] mt-1">
                Display price:{' '}
                <span className="font-mono text-[var(--ink)]">
                  ${Number(user.displayPrice ?? 0).toLocaleString()}
                </span>
                {user.periodEnd
                  ? ` · Expires ${new Date(user.periodEnd).toLocaleDateString()}${
                      user.periodDays ? ` (${user.periodDays}d)` : ''
                    }`
                  : ''}
              </p>
              <p className="text-xs text-[var(--ink3)] mt-1">
                Concurrently run up to {user.maxParallel} generation jobs in parallel. Excess requests queue automatically.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setRenewForm({
                    days: user.periodDays || 30,
                    standardCredits: 0,
                    proCredits: 0,
                    maxParallel: user.maxParallel || 1,
                    displayPrice: Number(user.displayPrice || 0),
                    reason: 'Admin renew custom deal',
                  });
                  setShowRenewModal(true);
                }}
                className="px-4 py-2 rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] hover:border-[var(--a1)] text-[var(--ink)] font-semibold text-xs transition-all"
              >
                Renew / Custom Deal
              </button>
              <button
                type="button"
                onClick={() => setShowPlanModal(true)}
                className="px-4 py-2 rounded-[11px] bg-[var(--a1)] hover:opacity-90 text-[var(--onA)] font-semibold text-xs transition-all "
              >
                Change Catalog Plan
              </button>
            </div>
          </div>

          {/* Orders / Subscriptions Table */}
          <div className="rounded-[18px] border border-[var(--line)] bg-[var(--card)] overflow-hidden">
            <div className="p-4 border-b border-[var(--line)] flex items-center justify-between">
              <h3 className="font-bold text-[var(--ink)] text-xs uppercase tracking-wider">Subscription & Order History</h3>
              <span className="text-[11px] text-[var(--ink3)] font-mono">{user.orders.length} orders</span>
            </div>
            {user.orders.length === 0 ? (
              <div className="py-16 text-center text-[var(--ink3)] text-xs">No orders or payment transactions on file.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)] border-b border-[var(--line)]">
                    <tr>
                      <th className="px-4 py-3">Order ID</th>
                      <th className="px-4 py-3">Plan</th>
                      <th className="px-4 py-3">Gateway</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {user.orders.map((ord) => (
                      <tr key={ord.id} className="border-t border-[var(--line)] hover:bg-[var(--bg2)]/50">
                        <td className="px-4 py-3 font-mono text-[var(--ink3)] truncate max-w-[120px]">{ord.id}</td>
                        <td className="px-4 py-3 font-semibold text-[var(--ink)]">{ord.plan.name}</td>
                        <td className="px-4 py-3 text-[var(--ink2)] font-mono">{ord.gateway}</td>
                        <td className="px-4 py-3 font-bold text-[var(--ink)] font-mono">${ord.amount}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              ord.status === 'COMPLETED'
                                ? 'bg-[var(--a1soft)] text-[var(--a1)] border border-[var(--a1)]/30'
                                : ord.status === 'PENDING_APPROVAL'
                                ? 'bg-[var(--a2soft)] text-[var(--a2)] border border-[var(--a2)]/30'
                                : 'bg-rose-500/15 text-rose-500 border border-rose-500/30'
                            }`}
                          >
                            {ord.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[var(--ink3)]">{new Date(ord.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: PROVIDER ROUTING & SETTINGS */}
      {activeTab === 'settings' && (
        <div className="space-y-6">
          <div className="p-6 rounded-[18px] border border-[var(--line)] bg-[var(--card)] space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-[var(--ink)] flex items-center gap-2">
                  <Server className="w-4 h-4 text-[var(--a1)]" />
                  Assigned Google Flow Provider Account
                </h2>
                <p className="text-xs text-[var(--ink3)] mt-0.5">
                  Manual pin stays locked until you switch back to Automatic. Pinning onto a full
                  account relocates other automatic users to free a slot.
                </p>
              </div>
              {user.assignedProviderAccount && (
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-[var(--a1soft)] text-[var(--a1)] border border-[var(--a1)]/20 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  {user.providerAssignmentManual ? 'Manual' : 'Auto'}: {user.assignedProviderAccount.label}
                </span>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="w-full sm:w-80 px-3.5 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] text-xs focus:outline-none focus:border-[var(--a1)]"
              >
                <option value="" className="bg-[var(--bg2)]">
                  Automatic (reallocate on save)
                </option>
                {providerAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id} className="bg-[var(--bg2)]">
                    {acc.label} ({acc.googleCreditsBalance} cr - {acc.accountEmail})
                  </option>
                ))}
              </select>

              <button
                onClick={handleSaveAssignedAccount}
                disabled={savingAccount}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-[11px] bg-[var(--a1)] hover:opacity-90 text-[var(--onA)] text-xs font-semibold transition-all disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingAccount ? 'Saving...' : 'Save Routing'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: STUDIO LOGS */}
      {activeTab === 'studio-logs' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-[18px] border border-[var(--line)] bg-[var(--card)]">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={studioLogLevel}
                onChange={(e) => setStudioLogLevel(e.target.value)}
                className="rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-1.5 text-xs text-[var(--ink)]"
              >
                <option value="ALL">All levels</option>
                <option value="INFO">Info</option>
                <option value="WARN">Warn</option>
                <option value="ERROR">Error</option>
                <option value="DEBUG">Debug</option>
              </select>
              <input
                value={studioLogQ}
                onChange={(e) => setStudioLogQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') fetchStudioLogs();
                }}
                placeholder="Search message…"
                className="rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-1.5 text-xs text-[var(--ink)] min-w-[180px]"
              />
            </div>
            <button
              type="button"
              onClick={fetchStudioLogs}
              className="inline-flex items-center gap-1.5 rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-1.5 text-xs font-medium"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${studioLogsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--card)]">
            {studioLogsLoading && studioLogs.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-[var(--ink3)]">Loading…</div>
            ) : studioLogs.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-[var(--ink3)]">
                No studio logs for this user yet.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {studioLogs.map((log) => (
                  <li key={log.id} className="flex items-start gap-3 px-4 py-2.5 text-xs">
                    <span className="w-[130px] shrink-0 font-mono text-[10px] text-[var(--ink3)]">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                    <span
                      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                        log.level === 'ERROR'
                          ? 'bg-rose-500/15 text-rose-500'
                          : log.level === 'WARN'
                            ? 'bg-[var(--a2soft)] text-[var(--a2)]'
                            : 'bg-[var(--a1soft)] text-[var(--a1)]'
                      }`}
                    >
                      {log.level}
                    </span>
                    <span className="shrink-0 rounded-md bg-[var(--bg3)] px-1.5 py-0.5 font-mono text-[10px]">
                      {log.source}
                    </span>
                    <span className="min-w-0 flex-1 text-[var(--ink)] break-words">{log.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* PASSWORD RESET MODAL */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--bg)]/80 backdrop-blur-sm animate-in fade-in">
          <div className="p-6 rounded-[18px] border border-[var(--line)] bg-[var(--card)] max-w-md w-full shadow-2xl space-y-4">
            <div>
              <h3 className="text-lg font-bold text-[var(--ink)] flex items-center gap-2">
                <Key className="w-5 h-5 text-[var(--a2)]" />
                Change Password for {user.name || user.email}
              </h3>
              <p className="text-xs text-[var(--ink3)] mt-1">
                Direct administrative override. The user will immediately sign in with this new password.
              </p>
            </div>

            {passwordFeedback && (
              <div
                className={`p-3 rounded-[11px] text-xs flex items-center gap-2 ${
                  passwordFeedback.type === 'success'
                    ? 'bg-[var(--a1soft)] text-[var(--a1)] border border-[var(--a1)]/30'
                    : 'bg-rose-500/15 text-rose-500 border border-rose-500/30'
                }`}
              >
                {passwordFeedback.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                <span>{passwordFeedback.text}</span>
              </div>
            )}

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--ink2)] mb-1">New Password</label>
                <div className="relative">
                  <input
                    type={showPasswordText ? 'text' : 'password'}
                    required
                    autoFocus
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 6 characters..."
                    className="w-full px-3.5 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] text-xs focus:outline-none focus:border-[var(--a1)] pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswordText(!showPasswordText)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink3)] hover:text-[var(--ink)]"
                  >
                    {showPasswordText ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--ink2)] mb-1">Confirm New Password</label>
                <input
                  type={showPasswordText ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-type new password..."
                  className="w-full px-3.5 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] text-xs focus:outline-none focus:border-[var(--a1)]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordModal(false);
                    setPasswordFeedback(null);
                  }}
                  className="btn-secondary !px-4 !py-2 !text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={passwordLoading}
                  className="btn-primary !px-5 !py-2 !text-xs disabled:opacity-50"
                >
                  {passwordLoading ? 'Saving...' : 'Set Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PLAN CHANGE MODAL */}
      {showPlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--bg)]/80 backdrop-blur-sm animate-in fade-in">
          <div className="p-6 rounded-[18px] border border-[var(--line)] bg-[var(--card)] max-w-md w-full shadow-2xl space-y-4">
            <div>
              <h3 className="text-lg font-bold text-[var(--ink)] flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[var(--a1)]" />
                Change Plan Tier
              </h3>
              <p className="text-xs text-[var(--ink3)] mt-1">
                Target User: <span className="font-mono text-[var(--ink)]">{user.email}</span>
              </p>
            </div>

            <form onSubmit={handleUpdatePlan} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--ink2)] mb-1">Select Plan</label>
                <select
                  value={selectedPlanName}
                  onChange={(e) => setSelectedPlanName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] text-xs focus:outline-none focus:border-[var(--a1)]"
                >
                  {availablePlans.length > 0 ? (
                    availablePlans.map((p) => (
                      <option key={p.id} value={p.name} className="bg-[var(--bg2)]">
                        {p.name} ({p.maxParallel} parallel slots) - ${p.priceMonthly}/mo
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="Free" className="bg-[var(--bg2)]">Free (1 slot)</option>
                      <option value="Starter" className="bg-[var(--bg2)]">Starter (3 slots)</option>
                      <option value="Pro" className="bg-[var(--bg2)]">Pro (5 slots)</option>
                      <option value="Business" className="bg-[var(--bg2)]">Business (10 slots)</option>
                    </>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--ink2)] mb-1">Reason for Change</label>
                <input
                  type="text"
                  required
                  value={planReason}
                  onChange={(e) => setPlanReason(e.target.value)}
                  placeholder="e.g. VIP client upgrade, promo offer"
                  className="w-full px-3.5 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] text-xs focus:outline-none focus:border-[var(--a1)]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPlanModal(false)}
                  className="btn-secondary !px-4 !py-2 !text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={planLoading}
                  className="btn-primary !px-5 !py-2 !text-xs disabled:opacity-50"
                >
                  {planLoading ? 'Updating...' : 'Update Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRenewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--bg)]/80 backdrop-blur-sm">
          <div className="p-6 rounded-[18px] border border-[var(--line)] bg-[var(--card)] max-w-lg w-full shadow-2xl space-y-4">
            <div>
              <h3 className="text-lg font-bold text-[var(--ink)]">Renew / Custom Deal</h3>
              <p className="text-xs text-[var(--ink3)] mt-1">
                Target: <span className="font-mono text-[var(--ink)]">{user.email}</span>
              </p>
            </div>
            <form onSubmit={handleRenewDeal} className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--ink2)] mb-1">Days</label>
                <input
                  type="number"
                  min={1}
                  required
                  value={renewForm.days}
                  onChange={(e) => setRenewForm({ ...renewForm, days: Number(e.target.value) })}
                  className="w-full px-3.5 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--ink2)] mb-1">Display price ($)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={renewForm.displayPrice}
                  onChange={(e) => setRenewForm({ ...renewForm, displayPrice: Number(e.target.value) })}
                  className="w-full px-3.5 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--ink2)] mb-1">Max parallel</label>
                <input
                  type="number"
                  min={1}
                  value={renewForm.maxParallel}
                  onChange={(e) => setRenewForm({ ...renewForm, maxParallel: Number(e.target.value) })}
                  className="w-full px-3.5 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--ink2)] mb-1">Standard credits</label>
                <input
                  type="number"
                  min={0}
                  value={renewForm.standardCredits}
                  onChange={(e) => setRenewForm({ ...renewForm, standardCredits: Number(e.target.value) })}
                  className="w-full px-3.5 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--ink2)] mb-1">Pro credits</label>
                <input
                  type="number"
                  min={0}
                  value={renewForm.proCredits}
                  onChange={(e) => setRenewForm({ ...renewForm, proCredits: Number(e.target.value) })}
                  className="w-full px-3.5 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] text-xs"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold uppercase text-[var(--ink2)] mb-1">Reason</label>
                <input
                  type="text"
                  value={renewForm.reason}
                  onChange={(e) => setRenewForm({ ...renewForm, reason: e.target.value })}
                  className="w-full px-3.5 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] text-xs"
                />
              </div>
              <div className="sm:col-span-2 flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowRenewModal(false)} className="btn-secondary !px-4 !py-2 !text-xs">
                  Cancel
                </button>
                <button type="submit" disabled={renewLoading} className="btn-primary !px-5 !py-2 !text-xs disabled:opacity-50">
                  {renewLoading ? 'Saving…' : 'Apply deal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREDIT ADJUSTMENT MODAL */}
      {showCreditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--bg)]/80 backdrop-blur-sm animate-in fade-in">
          <div className="p-6 rounded-[18px] border border-[var(--line)] bg-[var(--card)] max-w-md w-full shadow-2xl space-y-4">
            <div>
              <h3 className="text-lg font-bold text-[var(--ink)] flex items-center gap-2">
                <Coins className="w-5 h-5 text-[var(--a1)]" />
                Adjust User Credits
              </h3>
              <p className="text-xs text-[var(--ink3)] mt-1">
                Target User: <span className="font-mono text-[var(--ink)]">{user.email}</span>
              </p>
            </div>

            <form onSubmit={handleAdjustCredits} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--ink2)] mb-1">Wallet Target</label>
                <select
                  value={creditWallet}
                  onChange={(e) => setCreditWallet(e.target.value as any)}
                  className="w-full px-3.5 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] text-xs"
                >
                  <option value="STANDARD" className="bg-[var(--bg2)]">Standard Wallet (Lite models)</option>
                  <option value="PRO" className="bg-[var(--bg2)]">Pro Wallet (Veo 3.1 & Omni models)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--ink2)] mb-1">
                  Credit Delta (Positive to add, Negative to deduct)
                </label>
                <input
                  type="number"
                  required
                  value={creditDelta}
                  onChange={(e) => setCreditDelta(parseInt(e.target.value) || 0)}
                  className="w-full px-3.5 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-[var(--ink2)] mb-1">Adjustment Reason</label>
                <input
                  type="text"
                  required
                  value={creditReason}
                  onChange={(e) => setCreditReason(e.target.value)}
                  placeholder="e.g. Plan top-up, compensation, refund"
                  className="w-full px-3.5 py-2.5 rounded-[11px] bg-[var(--bg2)] border border-[var(--line)] text-[var(--ink)] text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreditModal(false)}
                  className="btn-secondary !px-4 !py-2 !text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creditLoading}
                  className="btn-primary !px-5 !py-2 !text-xs disabled:opacity-50"
                >
                  {creditLoading ? 'Applying...' : 'Apply Credits'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MEDIA LIGHTBOX MODAL */}
      {previewMedia && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--bg)]/90 backdrop-blur-md animate-in fade-in"
          onClick={() => setPreviewMedia(null)}
        >
          <div className="max-w-4xl w-full space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between text-xs text-[var(--ink3)]">
              <span className="line-clamp-1 italic text-[var(--ink)]">&ldquo;{previewMedia.prompt}&rdquo;</span>
              <button
                onClick={() => setPreviewMedia(null)}
                className="px-3 py-1 rounded-lg bg-[var(--bg2)] hover:bg-[var(--bg2)] text-[var(--ink)] font-semibold"
              >
                Close
              </button>
            </div>
            <div className="rounded-[18px] overflow-hidden border-[var(--line)] bg-[var(--card)] bg-black flex items-center justify-center max-h-[75vh]">
              {previewMedia.type === 'video' ? (
                <video src={previewMedia.url} controls autoPlay className="w-full max-h-[75vh] object-contain" />
              ) : (
                <img src={previewMedia.url} alt="Output" className="w-full max-h-[75vh] object-contain" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
