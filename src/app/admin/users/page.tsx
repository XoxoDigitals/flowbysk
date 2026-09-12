'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Users,
  Search,
  Ban,
  CheckCircle,
  Edit2,
  ArrowUpRight,
  Plus,
  Trash2,
} from 'lucide-react';

interface UserItem {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  plan: string;
  maxParallel: number;
  ownerLabel?: string;
  createdByLabel?: string | null;
  resellerLabel?: string | null;
  acquiredVia?: string;
  standardCredits: { available: number; total: number; reserved: number };
  proCredits: { available: number; total: number; reserved: number };
  totalJobs: number;
  totalProjects: number;
  assignedAccount: string;
  assignedAccountEmail?: string | null;
  assignedAccountId?: string | null;
  providerAssignmentManual?: boolean;
  lastSeenAt?: string | null;
  isOnline?: boolean;
  createdAt: string;
}

const inputClass =
  'w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-xs text-[var(--ink)] placeholder:text-[var(--ink3)] outline-none focus:border-[var(--a1)]';
const labelClass =
  'mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]';
const thClass =
  'px-4 py-3 text-left font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]';
const modalShell =
  'fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg)]/80 p-4 backdrop-blur-sm';
const modalCard =
  'w-full max-w-md rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8';

type Chip = { id: string; label: string };

function FilterChips({
  options,
  value,
  onChange,
}: {
  options: Chip[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`rounded-[10px] px-3 py-1.5 text-xs font-semibold transition ${
            value === t.id
              ? 'bg-[var(--a1soft)] text-[var(--a1)]'
              : 'text-[var(--ink3)] hover:bg-[var(--bg2)] hover:text-[var(--ink)]'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [onlineFilter, setOnlineFilter] = useState('ALL');
  const [planFilter, setPlanFilter] = useState('ALL');
  const [assignmentFilter, setAssignmentFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);
  const [adjustWallet, setAdjustWallet] = useState<'STANDARD' | 'PRO'>('STANDARD');
  const [adjustDelta, setAdjustDelta] = useState<number>(10);
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustLoading, setAdjustLoading] = useState(false);
  const [modalFeedback, setModalFeedback] = useState<string | null>(null);

  const [planUser, setPlanUser] = useState<UserItem | null>(null);
  const [selectedPlan, setSelectedPlan] = useState('Pro');
  const [planReason, setPlanReason] = useState('Admin discretionary upgrade');
  const [planLoading, setPlanLoading] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createFeedback, setCreateFeedback] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({
    email: '',
    password: '',
    name: '',
    mode: 'custom' as 'custom' | 'catalog',
    planName: 'Starter',
    days: 30,
    standardCredits: 0,
    proCredits: 0,
    maxParallel: 1,
    displayPrice: 0,
  });
  const [catalogPlans, setCatalogPlans] = useState<{ name: string }[]>([]);
  const [ownerFilter, setOwnerFilter] = useState('ALL');
  const [viaFilter, setViaFilter] = useState('ALL');
  const [resellerFilter, setResellerFilter] = useState('ALL');
  const [filterMeta, setFilterMeta] = useState<{
    staff: { id: string; name: string | null; email: string }[];
    resellers: { id: string; label: string }[];
  }>({ staff: [], resellers: [] });

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('q', search.trim());
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (onlineFilter !== 'ALL') params.set('online', onlineFilter);
      if (planFilter !== 'ALL') params.set('plan', planFilter);
      if (assignmentFilter !== 'ALL') params.set('assignment', assignmentFilter);
      if (ownerFilter !== 'ALL') params.set('owner', ownerFilter);
      if (viaFilter !== 'ALL') params.set('via', viaFilter);
      if (resellerFilter !== 'ALL') params.set('reseller', resellerFilter);

      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        if (data.filters) setFilterMeta(data.filters);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch('/api/admin/plans')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.plans) {
          setCatalogPlans(
            d.plans
              .filter((p: { name: string; isActive?: boolean }) => p.name !== 'Custom' && p.isActive !== false)
              .map((p: { name: string }) => ({ name: p.name }))
          );
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      fetchUsers();
    }, search ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, onlineFilter, planFilter, assignmentFilter, ownerFilter, viaFilter, resellerFilter]);

  const handleAdjustCredits = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !adjustReason.trim()) return;

    setAdjustLoading(true);
    setModalFeedback(null);

    try {
      const res = await fetch(`/api/admin/users/${selectedUser.id}/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletType: adjustWallet,
          delta: adjustDelta,
          reason: adjustReason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to adjust credits');
      }

      setSelectedUser(null);
      setAdjustReason('');
      fetchUsers();
    } catch (err: any) {
      setModalFeedback(err.message);
    } finally {
      setAdjustLoading(false);
    }
  };

  const handleUpdatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planUser) return;

    setPlanLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${planUser.id}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planName: selectedPlan,
          reason: planReason,
        }),
      });

      if (res.ok) {
        setPlanUser(null);
        fetchUsers();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setPlanLoading(false);
    }
  };

  const handleToggleBan = async (user: UserItem) => {
    const isBanned = user.status === 'BANNED';
    const reason = prompt(
      `Enter reason to ${isBanned ? 'unban' : 'ban'} user ${user.email}:`,
      isBanned ? 'Account appeal approved' : 'Violation of platform terms'
    );
    if (!reason) return;

    try {
      await fetch(`/api/admin/users/${user.id}/ban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banned: !isBanned, reason }),
      });
      fetchUsers();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteUser = async (user: UserItem) => {
    if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
      alert('Admin accounts cannot be deleted from this list.');
      return;
    }
    const ok = window.confirm(
      `Permanently delete ${user.email}? This removes their projects, jobs, and wallets.`
    );
    if (!ok) return;
    const typed = window.prompt(`Type DELETE to confirm deleting ${user.email}:`);
    if (typed !== 'DELETE') return;
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      fetchUsers();
    } catch (err: any) {
      alert(err.message || 'Delete failed');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateLoading(true);
    setCreateFeedback(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');
      setShowCreate(false);
      setCreateForm({
        email: '',
        password: '',
        name: '',
        mode: 'custom',
        planName: 'Starter',
        days: 30,
        standardCredits: 0,
        proCredits: 0,
        maxParallel: 1,
        displayPrice: 0,
      });
      fetchUsers();
    } catch (err: any) {
      setCreateFeedback(err.message);
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="flex items-center gap-2 text-[13px] text-[var(--ink3)]">
            <Users className="h-4 w-4 text-[var(--a1)]" />
            Audit accounts, credit ledgers, and parallel limits
          </p>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <button type="button" className="btn-primary !text-[13px]" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add user
          </button>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink3)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search email or name..."
              className={`${inputClass} pl-9`}
            />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--card)]">
        <div className="flex flex-col gap-3 border-b border-[var(--line)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <FilterChips
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { id: 'ALL', label: 'All status' },
                { id: 'ACTIVE', label: 'Active' },
                { id: 'BANNED', label: 'Banned' },
              ]}
            />
            <span className="text-xs text-[var(--ink3)]">
              {loading ? 'Loading…' : `Showing ${users.length} users`}
            </span>
          </div>
          <FilterChips
            value={onlineFilter}
            onChange={setOnlineFilter}
            options={[
              { id: 'ALL', label: 'All presence' },
              { id: 'ONLINE', label: 'Online' },
              { id: 'OFFLINE', label: 'Offline' },
            ]}
          />
          <FilterChips
            value={planFilter}
            onChange={setPlanFilter}
            options={[
              { id: 'ALL', label: 'All plans' },
              { id: 'Free', label: 'Free' },
              { id: 'Starter', label: 'Starter' },
              { id: 'Pro', label: 'Pro' },
              { id: 'Business', label: 'Business' },
            ]}
          />
          <FilterChips
            value={assignmentFilter}
            onChange={setAssignmentFilter}
            options={[
              { id: 'ALL', label: 'All assignments' },
              { id: 'ASSIGNED', label: 'Assigned account' },
              { id: 'UNASSIGNED', label: 'Unassigned' },
            ]}
          />
          <FilterChips
            value={viaFilter}
            onChange={setViaFilter}
            options={[
              { id: 'ALL', label: 'All sources' },
              { id: 'SIGNUP', label: 'Website signup' },
              { id: 'ADMIN_MANUAL', label: 'Admin added' },
              { id: 'RESELLER', label: 'Reseller added' },
            ]}
          />
          {filterMeta.staff.length > 0 && (
            <FilterChips
              value={ownerFilter}
              onChange={setOwnerFilter}
              options={[
                { id: 'ALL', label: 'All owners' },
                { id: 'UNCLAIMED', label: 'Unclaimed' },
                ...filterMeta.staff.map((s) => ({
                  id: s.id,
                  label: s.name || s.email,
                })),
              ]}
            />
          )}
          {filterMeta.resellers.length > 0 && (
            <FilterChips
              value={resellerFilter}
              onChange={setResellerFilter}
              options={[
                { id: 'ALL', label: 'All resellers' },
                ...filterMeta.resellers.map((r) => ({ id: r.id, label: r.label })),
              ]}
            />
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr>
                <th className={thClass}>User</th>
                <th className={thClass}>Owner / Source</th>
                <th className={thClass}>Plan & Slots</th>
                <th className={thClass}>Standard</th>
                <th className={thClass}>Pro</th>
                <th className={thClass}>Jobs</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>Assigned Account</th>
                <th className={`${thClass} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && users.length === 0 ? (
                <tr>
                  <td colSpan={9} className="border-t border-[var(--line)] px-4 py-10 text-center text-[var(--ink3)]">
                    Loading users…
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={9} className="border-t border-[var(--line)] px-4 py-10 text-center text-[var(--ink3)]">
                    No users match these filters.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="border-t border-[var(--line)] hover:bg-[var(--bg2)]/50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="group flex items-center gap-1 font-semibold text-[var(--ink)] hover:text-[var(--a1)]"
                      >
                        <span>{u.name || 'Anonymous'}</span>
                        <ArrowUpRight className="h-3 w-3 text-[var(--ink3)] group-hover:text-[var(--a1)]" />
                      </Link>
                      <div className="font-mono text-[11px] text-[var(--ink3)]">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--ink)]">{u.ownerLabel || '—'}</div>
                      <div className="text-[10px] text-[var(--ink3)]">
                        {u.acquiredVia || 'SIGNUP'}
                        {u.resellerLabel ? ` · ${u.resellerLabel}` : ''}
                        {u.createdByLabel ? ` · by ${u.createdByLabel}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[var(--ink)]">{u.plan}</span>
                        <span className="text-[10px] text-[var(--ink3)]">({u.maxParallel} slots)</span>
                        <button
                          type="button"
                          onClick={() => {
                            setPlanUser(u);
                            setSelectedPlan(u.plan);
                          }}
                          className="p-1 text-[var(--ink3)] hover:text-[var(--a1)]"
                          title="Change Plan"
                        >
                          <Edit2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-[var(--ink)]">{u.standardCredits.available}</span>
                      {u.standardCredits.reserved > 0 && (
                        <span className="ml-1 text-[10px] text-[var(--ink3)]">
                          ({u.standardCredits.reserved} reserved)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-[var(--ink)]">{u.proCredits.available}</span>
                      {u.proCredits.reserved > 0 && (
                        <span className="ml-1 text-[10px] text-[var(--ink3)]">
                          ({u.proCredits.reserved} reserved)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[var(--ink)]">{u.totalJobs}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                            u.status === 'ACTIVE'
                              ? 'bg-[var(--a1soft)] text-[var(--a1)]'
                              : 'bg-rose-500/15 text-rose-500'
                          }`}
                        >
                          {u.status}
                        </span>
                        {u.isOnline && (
                          <span className="rounded-md bg-[var(--a1soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--a1)]">
                            ONLINE
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {u.assignedAccountId ? (
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-[12px] font-medium text-[var(--ink)]">{u.assignedAccount}</p>
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${
                                u.providerAssignmentManual
                                  ? 'bg-[var(--a2soft)] text-[var(--a2)]'
                                  : 'bg-[var(--bg2)] text-[var(--ink3)]'
                              }`}
                            >
                              {u.providerAssignmentManual ? 'MANUAL' : 'AUTO'}
                            </span>
                          </div>
                          {u.assignedAccountEmail && (
                            <p className="font-mono text-[10px] text-[var(--ink3)]">{u.assignedAccountEmail}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-[var(--ink3)]">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/users/${u.id}`}
                          className="btn-secondary !px-2.5 !py-1 !text-[11px]"
                        >
                          Manage
                        </Link>
                        <button
                          type="button"
                          onClick={() => setSelectedUser(u)}
                          className="btn-primary !px-2.5 !py-1 !text-[11px]"
                        >
                          Credits
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleBan(u)}
                          className={`rounded-lg p-1 transition ${
                            u.status === 'BANNED'
                              ? 'text-[var(--a1)] hover:bg-[var(--a1soft)]'
                              : 'text-rose-500 hover:bg-rose-500/10'
                          }`}
                          title={u.status === 'BANNED' ? 'Unban User' : 'Ban User'}
                        >
                          {u.status === 'BANNED' ? (
                            <CheckCircle className="h-4 w-4" />
                          ) : (
                            <Ban className="h-4 w-4" />
                          )}
                        </button>
                        {u.role === 'CUSTOMER' || u.role === 'RESELLER' ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteUser(u)}
                            className="rounded-lg p-1 text-rose-500 transition hover:bg-rose-500/10"
                            title="Delete user"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedUser && (
        <div className={modalShell}>
          <div className={modalCard}>
            <h3 className="mb-1 text-lg font-semibold tracking-[-0.02em] text-[var(--ink)]">
              Adjust User Credits
            </h3>
            <p className="mb-6 text-xs text-[var(--ink3)]">
              Target: <span className="font-mono text-[var(--ink)]">{selectedUser.email}</span>
            </p>

            {modalFeedback && (
              <div className="mb-4 rounded-[11px] border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-500">
                {modalFeedback}
              </div>
            )}

            <form onSubmit={handleAdjustCredits} className="space-y-4">
              <div>
                <label className={labelClass}>Wallet Type</label>
                <select
                  value={adjustWallet}
                  onChange={(e) => setAdjustWallet(e.target.value as any)}
                  className={inputClass}
                >
                  <option value="STANDARD">Standard Credits</option>
                  <option value="PRO">Pro Credits</option>
                </select>
              </div>

              <div>
                <label className={labelClass}>Delta (+ grant / − deduct)</label>
                <input
                  type="number"
                  required
                  value={adjustDelta}
                  onChange={(e) => setAdjustDelta(Number(e.target.value))}
                  placeholder="e.g. 50 or -10"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Audit Reason</label>
                <input
                  type="text"
                  required
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. Customer support compensation"
                  className={inputClass}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={() => setSelectedUser(null)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={adjustLoading} className="btn-primary">
                  {adjustLoading ? 'Recording…' : 'Commit Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {planUser && (
        <div className={modalShell}>
          <div className={modalCard}>
            <h3 className="mb-1 text-lg font-semibold tracking-[-0.02em] text-[var(--ink)]">
              Override Subscription Plan
            </h3>
            <p className="mb-6 text-xs text-[var(--ink3)]">
              Target: <span className="font-mono text-[var(--ink)]">{planUser.email}</span>
            </p>

            <form onSubmit={handleUpdatePlan} className="space-y-4">
              <div>
                <label className={labelClass}>Plan Tier</label>
                <select
                  value={selectedPlan}
                  onChange={(e) => setSelectedPlan(e.target.value)}
                  className={inputClass}
                >
                  <option value="Free">Free (1 Slot)</option>
                  <option value="Starter">Starter (3 Slots)</option>
                  <option value="Pro">Pro (5 Slots)</option>
                  <option value="Business">Business (10 Slots)</option>
                </select>
              </div>

              <div>
                <label className={labelClass}>Reason</label>
                <input
                  type="text"
                  required
                  value={planReason}
                  onChange={(e) => setPlanReason(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={() => setPlanUser(null)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={planLoading} className="btn-primary">
                  {planLoading ? 'Updating…' : 'Apply Plan Change'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCreate && (
        <div className={modalShell}>
          <div className={`${modalCard} max-w-lg`}>
            <h3 className="mb-1 text-lg font-semibold tracking-[-0.02em] text-[var(--ink)]">
              Add user · custom deal
            </h3>
            <p className="mb-6 text-xs text-[var(--ink3)]">
              Creates login + custom plan (days, credits, parallel, display price). Not shown on public pricing.
            </p>
            <form onSubmit={handleCreateUser} className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelClass}>Email</label>
                <input
                  required
                  type="email"
                  className={inputClass}
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Password</label>
                <input
                  required
                  minLength={6}
                  type="text"
                  className={inputClass}
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Name</label>
                <input
                  className={inputClass}
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Plan type</label>
                <select
                  className={inputClass}
                  value={createForm.mode}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      mode: e.target.value as 'custom' | 'catalog',
                    })
                  }
                >
                  <option value="custom">Custom deal</option>
                  <option value="catalog">Catalog plan</option>
                </select>
              </div>
              {createForm.mode === 'catalog' ? (
                <>
                  <div>
                    <label className={labelClass}>Catalog plan</label>
                    <select
                      className={inputClass}
                      value={createForm.planName}
                      onChange={(e) => setCreateForm({ ...createForm, planName: e.target.value })}
                    >
                      {catalogPlans.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Display price ($)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className={inputClass}
                      value={createForm.displayPrice}
                      onChange={(e) => setCreateForm({ ...createForm, displayPrice: Number(e.target.value) })}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className={labelClass}>Days</label>
                    <input
                      type="number"
                      min={1}
                      required
                      className={inputClass}
                      value={createForm.days}
                      onChange={(e) => setCreateForm({ ...createForm, days: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Display price ($)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className={inputClass}
                      value={createForm.displayPrice}
                      onChange={(e) => setCreateForm({ ...createForm, displayPrice: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Max parallel</label>
                    <input
                      type="number"
                      min={1}
                      className={inputClass}
                      value={createForm.maxParallel}
                      onChange={(e) => setCreateForm({ ...createForm, maxParallel: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Standard credits</label>
                    <input
                      type="number"
                      min={0}
                      className={inputClass}
                      value={createForm.standardCredits}
                      onChange={(e) => setCreateForm({ ...createForm, standardCredits: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Pro credits</label>
                    <input
                      type="number"
                      min={0}
                      className={inputClass}
                      value={createForm.proCredits}
                      onChange={(e) => setCreateForm({ ...createForm, proCredits: Number(e.target.value) })}
                    />
                  </div>
                </>
              )}
              {createFeedback && (
                <p className="sm:col-span-2 text-xs text-rose-500">{createFeedback}</p>
              )}
              <div className="sm:col-span-2 flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={createLoading} className="btn-primary">
                  {createLoading ? 'Creating…' : 'Create user'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
