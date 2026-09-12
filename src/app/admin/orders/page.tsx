'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ShoppingBag,
  CheckCircle2,
  XCircle,
  Clock,
  DollarSign,
  Building2,
  MessageSquare,
  Eye,
  Settings,
  Save,
  ArrowUpRight,
} from 'lucide-react';

interface OrderItem {
  id: string;
  amount: number;
  currency: string;
  gateway: 'STRIPE' | 'MANUAL_BANK' | 'RESELLER';
  status: 'PENDING_APPROVAL' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
  bankReference: string | null;
  proofImageUrl: string | null;
  adminNotes: string | null;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name: string;
    lastIp: string | null;
  };
  plan: {
    id: string;
    name: string;
    priceMonthly: number;
    standardCreditsMonthly: number;
    proCreditsMonthly: number;
  };
}

interface Analytics {
  totalRevenue: number;
  pendingCount: number;
  completedCount: number;
  rejectedCount: number;
  totalOrders: number;
  gatewayStats: Record<string, { count: number; volume: number }>;
}

const inputClass =
  'w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3.5 py-2.5 text-xs text-[var(--ink)] placeholder:text-[var(--ink3)] outline-none focus:border-[var(--a1)]';
const thClass =
  'px-4 py-3.5 text-left font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]';
const modalShell =
  'fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg)]/80 p-4 backdrop-blur-sm';
const modalCard =
  'w-full rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8';

function orderStatusClass(status: string) {
  if (status === 'COMPLETED') return 'bg-[var(--a1soft)] text-[var(--a1)]';
  if (status === 'PENDING_APPROVAL') return 'bg-[var(--a2soft)] text-[var(--a2)]';
  return 'bg-rose-500/15 text-rose-500';
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>({
    totalRevenue: 0,
    pendingCount: 0,
    completedCount: 0,
    rejectedCount: 0,
    totalOrders: 0,
    gatewayStats: {},
  });
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  const [viewProofUrl, setViewProofUrl] = useState<string | null>(null);
  const [processingOrderId, setProcessingOrderId] = useState<string | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [resellerMessage, setResellerMessage] = useState('');
  const [bankDetails, setBankDetails] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  const fetchOrders = async () => {
    try {
      const res = await fetch(`/api/admin/orders?status=${statusFilter}`);
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
        if (data.analytics) setAnalytics(data.analytics);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/admin/orders/settings');
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          setResellerMessage(data.settings.resellerMessage || '');
          setBankDetails(data.settings.bankDetails || '');
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [statusFilter]);

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleApprove = async (orderId: string) => {
    if (!confirm('Approve this payment? The customer plan will be immediately activated and credits deposited.')) return;
    setProcessingOrderId(orderId);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'APPROVE' }),
      });
      if (res.ok) {
        fetchOrders();
      } else {
        alert('Failed to approve order');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setProcessingOrderId(null);
    }
  };

  const handleReject = async (orderId: string) => {
    const reason = prompt('Enter rejection reason (optional):') || 'Receipt verification failed';
    setProcessingOrderId(orderId);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'REJECT', adminNotes: reason }),
      });
      if (res.ok) {
        fetchOrders();
      } else {
        alert('Failed to reject order');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setProcessingOrderId(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await fetch('/api/admin/orders/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resellerMessage, bankDetails }),
      });
      if (res.ok) {
        setShowSettingsModal(false);
        alert('Billing gateway settings updated successfully');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <p className="flex items-center gap-2 text-[13px] text-[var(--ink3)]">
          <ShoppingBag className="h-4 w-4 text-[var(--a1)]" />
          Stripe · bank · reseller verification ledger
        </p>
        <button
          type="button"
          onClick={() => setShowSettingsModal(true)}
          className="btn-secondary !px-3.5 !py-2 !text-xs"
        >
          <Settings className="h-4 w-4" />
          Gateway & Reseller Settings
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        <div className="flex flex-col gap-2 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-5">
          <span className="flex items-center gap-1 font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
            <DollarSign className="h-3 w-3 text-[var(--a1)]" />
            GROSS REVENUE
          </span>
          <span className="font-mono text-[30px] font-semibold tracking-[-0.035em] text-[var(--a1)]">
            ${analytics.totalRevenue.toFixed(2)}
          </span>
          <span className="text-xs text-[var(--ink3)]">From approved orders</span>
        </div>
        <div className="flex flex-col gap-2 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-5">
          <span className="flex items-center gap-1 font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
            <Clock className="h-3 w-3 text-[var(--a2)]" />
            PENDING
          </span>
          <span className="text-[30px] font-semibold tracking-[-0.035em] text-[var(--a2)]">
            {analytics.pendingCount}
          </span>
          <span className="text-xs text-[var(--ink3)]">Awaiting approval</span>
        </div>
        <div className="flex flex-col gap-2 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-5">
          <span className="flex items-center gap-1 font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
            <CheckCircle2 className="h-3 w-3 text-[var(--a1)]" />
            COMPLETED
          </span>
          <span className="text-[30px] font-semibold tracking-[-0.035em]">{analytics.completedCount}</span>
          <span className="text-xs text-[var(--ink3)]">Activated plans</span>
        </div>
        <div className="flex flex-col gap-2 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-5">
          <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">GATEWAYS</span>
          <div className="space-y-1 font-mono text-xs text-[var(--ink2)]">
            <div className="flex justify-between">
              <span>Stripe</span>
              <span className="font-semibold text-[var(--ink)]">{analytics.gatewayStats.STRIPE?.count || 0}</span>
            </div>
            <div className="flex justify-between">
              <span>Bank</span>
              <span className="font-semibold text-[var(--ink)]">{analytics.gatewayStats.MANUAL_BANK?.count || 0}</span>
            </div>
            <div className="flex justify-between">
              <span>Reseller</span>
              <span className="font-semibold text-[var(--ink)]">{analytics.gatewayStats.RESELLER?.count || 0}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--card)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'ALL', label: 'All Orders' },
              { id: 'PENDING_APPROVAL', label: `Pending (${analytics.pendingCount})` },
              { id: 'COMPLETED', label: 'Completed' },
              { id: 'REJECTED', label: 'Rejected' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setStatusFilter(t.id)}
                className={`rounded-[10px] px-3 py-1.5 text-xs font-semibold transition ${
                  statusFilter === t.id
                    ? 'bg-[var(--a1soft)] text-[var(--a1)]'
                    : 'text-[var(--ink3)] hover:bg-[var(--bg2)] hover:text-[var(--ink)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-[var(--ink3)]">
            {loading ? 'Loading…' : `Showing ${orders.length} orders`}
          </span>
        </div>

        {orders.length === 0 ? (
          <div className="p-12 text-center text-xs text-[var(--ink3)]">No orders matching filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th className={thClass}>Order & Date</th>
                  <th className={thClass}>Customer</th>
                  <th className={thClass}>Plan & Amount</th>
                  <th className={thClass}>Gateway</th>
                  <th className={thClass}>Proof / Reference</th>
                  <th className={thClass}>Status</th>
                  <th className={`${thClass} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((ord) => {
                  const isPending = ord.status === 'PENDING_APPROVAL';
                  return (
                    <tr key={ord.id} className="border-t border-[var(--line)] hover:bg-[var(--bg2)]/50">
                      <td className="px-4 py-3.5">
                        <div className="font-mono font-semibold text-[var(--ink)]">{ord.id.substring(0, 10)}…</div>
                        <div className="text-[11px] text-[var(--ink3)]">
                          {new Date(ord.createdAt).toLocaleString()}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <Link
                          href={`/admin/users/${ord.user.id}`}
                          className="group flex items-center gap-1 font-semibold text-[var(--ink)] hover:text-[var(--a1)]"
                        >
                          <span>{ord.user.name || 'Anonymous'}</span>
                          <ArrowUpRight className="h-3 w-3 text-[var(--ink3)] group-hover:text-[var(--a1)]" />
                        </Link>
                        <div className="font-mono text-[11px] text-[var(--ink3)]">{ord.user.email}</div>
                        {ord.user.lastIp && (
                          <div className="font-mono text-[10px] text-[var(--ink3)]">IP: {ord.user.lastIp}</div>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-semibold text-[var(--ink)]">{ord.plan.name}</div>
                        <div className="font-mono text-[11px] font-semibold text-[var(--a1)]">${ord.amount}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="rounded-md bg-[var(--bg2)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[var(--ink2)]">
                          {ord.gateway === 'MANUAL_BANK'
                            ? 'Bank Transfer'
                            : ord.gateway === 'RESELLER'
                              ? 'Reseller'
                              : 'Stripe'}
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="space-y-1">
                          {ord.bankReference && (
                            <div className="max-w-xs truncate rounded-md bg-[var(--bg2)] px-2 py-0.5 font-mono text-[11px] text-[var(--ink2)]">
                              Ref: {ord.bankReference}
                            </div>
                          )}
                          {ord.proofImageUrl ? (
                            <button
                              type="button"
                              onClick={() => setViewProofUrl(ord.proofImageUrl)}
                              className="flex items-center gap-1 text-[11px] font-semibold text-[var(--a1)] hover:underline"
                            >
                              <Eye className="h-3 w-3" />
                              View screenshot
                            </button>
                          ) : (
                            <span className="text-[10px] text-[var(--ink3)]">No screenshot</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`inline-flex w-fit items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-semibold ${orderStatusClass(ord.status)}`}
                        >
                          {ord.status === 'COMPLETED' && <CheckCircle2 className="h-3 w-3" />}
                          {ord.status === 'PENDING_APPROVAL' && <Clock className="h-3 w-3" />}
                          {ord.status === 'REJECTED' && <XCircle className="h-3 w-3" />}
                          {ord.status}
                        </span>
                        {ord.adminNotes && (
                          <div className="mt-1 max-w-xs truncate text-[10px] text-[var(--ink3)]">
                            Note: {ord.adminNotes}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {isPending ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleApprove(ord.id)}
                              disabled={processingOrderId === ord.id}
                              className="btn-primary !px-3 !py-1.5 !text-[11px]"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReject(ord.id)}
                              disabled={processingOrderId === ord.id}
                              className="rounded-lg bg-rose-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-rose-500 hover:bg-rose-500/25 disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] font-medium text-[var(--ink3)]">Processed</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewProofUrl && (
        <div className={modalShell}>
          <div className={`${modalCard} flex max-h-[90vh] max-w-2xl flex-col`}>
            <div className="mb-4 flex items-center justify-between border-b border-[var(--line)] pb-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                <Eye className="h-4 w-4 text-[var(--a1)]" />
                Payment Proof
              </h3>
              <button
                type="button"
                onClick={() => setViewProofUrl(null)}
                className="rounded-lg p-1.5 text-[var(--ink3)] hover:bg-[var(--bg2)] hover:text-[var(--ink)]"
              >
                &times;
              </button>
            </div>
            <div className="flex flex-1 items-center justify-center overflow-auto rounded-[11px] bg-[var(--bg2)] p-2">
              <img src={viewProofUrl} alt="Payment proof" className="max-h-[65vh] rounded-lg object-contain" />
            </div>
            <div className="flex items-center justify-between pt-4 text-xs">
              <a
                href={viewProofUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--a1)] hover:underline"
              >
                Open original →
              </a>
              <button type="button" onClick={() => setViewProofUrl(null)} className="btn-secondary !px-4 !py-1.5">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettingsModal && (
        <div className={modalShell}>
          <div className={`${modalCard} max-w-lg`}>
            <h3 className="mb-1 text-lg font-semibold tracking-[-0.02em] text-[var(--ink)]">
              Billing Gateways
            </h3>
            <p className="mb-6 text-xs text-[var(--ink3)]">
              Reseller message and bank transfer instructions shown to customers.
            </p>

            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                  <MessageSquare className="h-3.5 w-3.5" />
                  Reseller Message
                </label>
                <textarea
                  rows={3}
                  required
                  value={resellerMessage}
                  onChange={(e) => setResellerMessage(e.target.value)}
                  placeholder="e.g. Contact reseller on Telegram…"
                  className={inputClass}
                />
              </div>

              <div>
                <label className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                  <Building2 className="h-3.5 w-3.5" />
                  Bank Transfer Details
                </label>
                <textarea
                  rows={4}
                  required
                  value={bankDetails}
                  onChange={(e) => setBankDetails(e.target.value)}
                  placeholder="Bank Name, IBAN, Account number…"
                  className={`${inputClass} font-mono`}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowSettingsModal(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={savingSettings} className="btn-primary">
                  <Save className="h-3.5 w-3.5" />
                  {savingSettings ? 'Saving…' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
