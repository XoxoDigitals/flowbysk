'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Building2,
  MessageSquare,
  CreditCard,
  Check,
} from 'lucide-react';

interface LedgerItem {
  id: string;
  walletType: string;
  amount: number;
  balanceAfter: number;
  type: string;
  reason: string;
  createdAt: string;
}

interface PlanItem {
  id: string;
  name: string;
  priceMonthly: number;
  contactSeller?: boolean;
  maxParallel: number;
  description: string;
  standardCreditsCycle: number;
  proCreditsCycle: number;
  features?: string[];
}

interface OrderItem {
  id: string;
  amount: number;
  currency: string;
  gateway: string;
  status: string;
  bankReference: string | null;
  proofImageUrl: string | null;
  createdAt: string;
  plan: { name: string };
}

export default function BillingPage() {
  const [userData, setUserData] = useState<any>(null);
  const [history, setHistory] = useState<LedgerItem[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedPlan, setSelectedPlan] = useState<PlanItem | null>(null);
  const [gateway, setGateway] = useState<'STRIPE' | 'MANUAL_BANK' | 'RESELLER'>('STRIPE');
  const [bankReference, setBankReference] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderSuccessMsg, setOrderSuccessMsg] = useState<string | null>(null);

  const [resellerMessage, setResellerMessage] = useState(
    'To purchase a plan via authorized reseller, contact us with your account email.'
  );
  const [bankDetails, setBankDetails] = useState(
    'Bank Name: Silicon Valley Bank\nAccount Name: Flowbysk\nInclude your account email in the transfer remarks.'
  );
  const [enabledGateways, setEnabledGateways] = useState({
    STRIPE: true,
    MANUAL_BANK: true,
    RESELLER: true,
  });

  const fetchBilling = async () => {
    try {
      const [uRes, wRes, pRes, oRes, cRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/wallet'),
        fetch('/api/plans'),
        fetch('/api/orders'),
        fetch('/api/billing/config'),
      ]);

      if (uRes.ok) {
        const uData = await uRes.json();
        setUserData(uData.user);
      }
      if (wRes.ok) {
        const wData = await wRes.json();
        setHistory(wData.history || []);
      }
      if (pRes.ok) {
        const pData = await pRes.json();
        setPlans(pData.plans || []);
      }
      if (oRes.ok) {
        const oData = await oRes.json();
        setOrders(oData.orders || []);
      }
      if (cRes.ok) {
        const cData = await cRes.json();
        const g = cData.gateways || {};
        setResellerMessage(g.resellerMessage || '');
        setBankDetails(g.bankDetails || '');
        const next = {
          STRIPE: g.stripeEnabled !== false,
          MANUAL_BANK: g.bankEnabled !== false,
          RESELLER: g.resellerEnabled !== false,
        };
        setEnabledGateways(next);
        const first =
          (next.STRIPE && 'STRIPE') ||
          (next.MANUAL_BANK && 'MANUAL_BANK') ||
          (next.RESELLER && 'RESELLER') ||
          'STRIPE';
        setGateway(first as any);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBilling();
  }, []);

  const usage = useMemo(() => {
    const stdAvail = userData?.wallets?.standard?.available ?? 0;
    const proAvail = userData?.wallets?.pro?.available ?? 0;
    const stdTotal = Math.max(userData?.wallets?.standard?.total ?? 0, stdAvail);
    const proTotal = Math.max(userData?.wallets?.pro?.total ?? 0, proAvail);
    const available = stdAvail + proAvail;
    const total = stdTotal + proTotal || Math.max(available, 1);
    const used = Math.max(0, total - available);
    const pct = Math.min(100, Math.round((used / total) * 100));
    return { available, total, used, pct };
  }, [userData]);

  const currentPlan = plans.find((p) => p.name === userData?.plan) || null;
  const payablePlans = plans.filter((p) => !p.contactSeller && p.priceMonthly > 0);
  const upgradeTarget =
    payablePlans.find((p) => p.priceMonthly > (currentPlan?.priceMonthly ?? 0)) ||
    payablePlans.find((p) => p.name !== userData?.plan) ||
    null;
  const sellerPlanNotice =
    plans.find(
      (p) =>
        p.contactSeller &&
        p.name !== userData?.plan &&
        p.priceMonthly >= (currentPlan?.priceMonthly ?? 0)
    ) || plans.find((p) => p.contactSeller && p.name !== userData?.plan) || null;

  const statusLabel = (status: string) => {
    if (status === 'COMPLETED') return 'Paid';
    if (status === 'PENDING_APPROVAL') return 'Pending';
    return status;
  };

  const statusColor = (status: string) => {
    if (status === 'COMPLETED') return 'var(--a1)';
    if (status === 'PENDING_APPROVAL') return 'var(--a2)';
    return 'var(--ink3)';
  };

  const handleProofFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProofFile(file);
    setUploadingProof(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload/proof', { method: 'POST', body: fd });
      if (res.ok) {
        const data = await res.json();
        setProofPreviewUrl(data.url);
      } else {
        alert('Failed to upload proof screenshot');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUploadingProof(false);
    }
  };

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan || selectedPlan.contactSeller || gateway === 'RESELLER') return;
    setSubmittingOrder(true);
    setOrderSuccessMsg(null);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: selectedPlan.id,
          gateway,
          bankReference: bankReference.trim(),
          proofImageUrl: proofPreviewUrl,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setOrderSuccessMsg(data.message || 'Order successfully processed!');
        fetchBilling();
        setTimeout(() => {
          setSelectedPlan(null);
          setOrderSuccessMsg(null);
          setBankReference('');
          setProofPreviewUrl(null);
          setProofFile(null);
        }, 2200);
      } else {
        alert(data.error || 'Failed to process order');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingOrder(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-[var(--ink3)]">Loading billing…</p>;
  }

  return (
    <div className="grid gap-3.5 lg:grid-cols-2 lg:items-start">
      <div className="flex min-w-0 flex-col gap-3.5">
        {/* Current plan */}
        <div className="flex flex-col gap-4 rounded-[18px] border border-[var(--a1)] bg-[var(--card)] p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3.5">
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="font-mono text-[10px] font-medium tracking-[0.12em] text-[var(--a1)]">
                CURRENT PLAN
              </span>
              <h3 className="text-xl font-semibold tracking-[-0.03em] sm:text-2xl">
                {userData?.plan || 'Free'}
                <span className="text-[var(--ink2)]">
                  {' '}
                  ·{' '}
                  {userData?.isCustomDeal || userData?.displayPrice != null
                    ? `$${Number(userData.displayPrice || 0).toLocaleString()}`
                    : currentPlan?.contactSeller
                      ? 'Contact Your Seller'
                      : currentPlan
                        ? currentPlan.priceMonthly === 0
                          ? 'Free'
                          : `$${currentPlan.priceMonthly}/mo`
                        : '—'}
                </span>
              </h3>
              <span className="text-[12px] text-[var(--ink3)] sm:text-[13px]">
                {userData?.maxParallel ?? 1} concurrent slots · Standard{' '}
                {userData?.wallets?.standard?.available ?? 0} · Pro{' '}
                {userData?.wallets?.pro?.available ?? 0}
                {userData?.periodEnd ? (
                  <>
                    {' '}
                    · Expires {new Date(userData.periodEnd).toLocaleDateString()}
                    {userData?.periodDays ? ` (${userData.periodDays}d)` : ''}
                  </>
                ) : null}
              </span>
            </div>
            {upgradeTarget ? (
              <button
                type="button"
                className="btn-primary w-full !px-4 !py-2.5 !text-[13px] sm:w-auto"
                onClick={() => {
                  setSelectedPlan(upgradeTarget);
                  setGateway('STRIPE');
                }}
              >
                Upgrade to {upgradeTarget.name}
              </button>
            ) : sellerPlanNotice ? (
              <p className="w-full text-right text-[13px] font-semibold text-[var(--ink2)] sm:w-auto">
                Contact Your Seller
              </p>
            ) : (
              <Link href="/pricing" className="btn-primary w-full !px-4 !py-2.5 !text-[13px] sm:w-auto">
                View plans
              </Link>
            )}
          </div>
          <div className="flex flex-col gap-2 border-t border-[var(--line)] pt-4">
            <div className="flex justify-between text-[13px]">
              <span className="text-[var(--ink2)]">Credits used this cycle</span>
              <span className="font-mono">
                {usage.used.toLocaleString()} / {usage.total.toLocaleString()}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
              <div
                className="h-full rounded-full bg-[var(--a1)]"
                style={{ width: `${usage.pct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Wallet split */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
            <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
              STANDARD
            </span>
            <p className="mt-2 font-mono text-[28px] font-semibold tracking-[-0.03em]">
              {userData?.wallets?.standard?.available ?? 0}
            </p>
            <p className="mt-1 text-xs text-[var(--ink3)]">
              Reserved {userData?.wallets?.standard?.reserved ?? 0}
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
            <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">PRO</span>
            <p className="mt-2 font-mono text-[28px] font-semibold tracking-[-0.03em]">
              {userData?.wallets?.pro?.available ?? 0}
            </p>
            <p className="mt-1 text-xs text-[var(--ink3)]">
              Reserved {userData?.wallets?.pro?.reserved ?? 0}
            </p>
          </div>
        </div>

        {/* Invoices / orders */}
        <div className="flex flex-col gap-3.5 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-4 sm:p-[22px]">
          <h3 className="text-base font-semibold tracking-[-0.02em]">Invoices</h3>
          {orders.length === 0 ? (
            <p className="py-4 text-sm text-[var(--ink3)]">No invoices yet.</p>
          ) : (
            <div className="flex flex-col">
              {orders.slice(0, 8).map((ord) => (
                <div
                  key={ord.id}
                  className="flex flex-col gap-1 border-t border-[var(--line)] py-2.5 text-[13px] first:border-t-0 sm:grid sm:grid-cols-[1.2fr_1fr_0.8fr_0.7fr] sm:items-center sm:gap-3"
                >
                  <div className="flex items-center justify-between gap-2 sm:contents">
                    <span>{new Date(ord.createdAt).toLocaleDateString()}</span>
                    <span className="text-right sm:hidden" style={{ color: statusColor(ord.status) }}>
                      {statusLabel(ord.status)}
                    </span>
                  </div>
                  <span className="truncate text-[var(--ink2)]">{ord.plan?.name || 'Order'}</span>
                  <span className="font-mono">${ord.amount}</span>
                  <span className="hidden text-right sm:block" style={{ color: statusColor(ord.status) }}>
                    {statusLabel(ord.status)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Plans grid */}
        <div className="flex flex-col gap-3.5 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-4 sm:p-[22px]">
          <h3 className="text-base font-semibold tracking-[-0.02em]">Change plan</h3>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {plans.map((p) => {
              const isCurrent = userData?.plan === p.name;
              const contact = !!p.contactSeller;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={isCurrent || contact || p.priceMonthly <= 0}
                  onClick={() => {
                    if (contact || p.priceMonthly <= 0) return;
                    setSelectedPlan(p);
                    setGateway('STRIPE');
                  }}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    isCurrent
                      ? 'border-[var(--a1)] bg-[var(--a1soft)]'
                      : 'border-[var(--line)] bg-[var(--bg2)] hover:border-[var(--a1)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{p.name}</span>
                    {isCurrent && (
                      <span className="font-mono text-[10px] tracking-wider text-[var(--a1)]">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-col gap-0.5">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-[28px] font-semibold leading-none tracking-[-0.04em]">
                        {p.standardCreditsCycle.toLocaleString()}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--ink3)]">
                        std
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-[22px] font-semibold leading-none tracking-[-0.03em] text-[var(--a1)]">
                        {p.proCreditsCycle.toLocaleString()}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--ink3)]">
                        pro / cycle
                      </span>
                    </div>
                  </div>
                  <p className={`mt-2 ${contact ? 'text-[14px] font-semibold' : 'font-mono text-lg'}`}>
                    {contact
                      ? 'Contact Your Seller'
                      : p.priceMonthly === 0
                        ? 'Free'
                        : `$${p.priceMonthly}/mo`}
                  </p>
                  {p.description && (
                    <p className="mt-1 text-[12px] leading-relaxed text-[var(--ink2)]">{p.description}</p>
                  )}
                  <p className="mt-2 font-mono text-[11px] text-[var(--ink3)]">
                    {p.maxParallel} parallel slot{p.maxParallel === 1 ? '' : 's'}
                  </p>
                  {Array.isArray(p.features) && p.features.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1">
                      {p.features
                        .filter((f: string) => !/credits?\s*\/\s*cycle/i.test(f))
                        .slice(0, 6)
                        .map((f: string) => (
                        <li key={f} className="flex gap-1.5 text-[11px] text-[var(--ink2)]">
                          <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--a1)]" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3.5">
        {/* Ledger */}
        <div className="flex flex-col gap-3.5 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-4 sm:p-[22px]">
          <h3 className="text-base font-semibold tracking-[-0.02em]">Credit ledger</h3>
          {history.length === 0 ? (
            <p className="py-4 text-sm text-[var(--ink3)]">No ledger entries yet.</p>
          ) : (
            <div className="flex max-h-[480px] flex-col overflow-y-auto">
              {history.slice(0, 20).map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-3 border-t border-[var(--line)] py-2.5 text-[13px] first:border-t-0"
                >
                  <div className="min-w-0">
                    <p className="truncate">{entry.reason || entry.type}</p>
                    <p className="text-xs text-[var(--ink3)]">
                      {entry.walletType} · {new Date(entry.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 font-mono ${
                      entry.amount > 0
                        ? 'text-[var(--a1)]'
                        : entry.amount < 0
                          ? 'text-rose-400'
                          : 'text-[var(--ink3)]'
                    }`}
                  >
                    {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Checkout modal — seller-mode plans are message-only (no price / pay) */}
      {selectedPlan && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[18px] border border-[var(--line)] bg-[var(--card)] p-5 shadow-2xl sm:rounded-[18px] sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold">
                  {selectedPlan.contactSeller ? selectedPlan.name : `Subscribe to ${selectedPlan.name}`}
                </h3>
                {!selectedPlan.contactSeller && (
                  <p className="mt-0.5 text-[13px] text-[var(--ink3)]">
                    ${selectedPlan.priceMonthly}/month · {selectedPlan.maxParallel} parallel slots
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedPlan(null)}
                className="shrink-0 text-[var(--ink3)] hover:text-[var(--ink)]"
              >
                ×
              </button>
            </div>

            {selectedPlan.contactSeller ? (
              <p className="rounded-xl border border-[var(--line)] bg-[var(--bg2)] p-4 text-[14px] leading-relaxed text-[var(--ink2)]">
                Contact Your Seller
                {resellerMessage ? (
                  <>
                    <br />
                    <span className="mt-2 block text-[13px] text-[var(--ink3)]">{resellerMessage}</span>
                  </>
                ) : null}
              </p>
            ) : orderSuccessMsg ? (
              <div className="space-y-2 rounded-2xl border border-[var(--a1)]/30 bg-[var(--a1soft)] p-5 text-center text-[var(--a1)]">
                <CheckCircle2 className="mx-auto h-8 w-8" />
                <div className="text-sm font-semibold">{orderSuccessMsg}</div>
              </div>
            ) : (
              <form onSubmit={handleCheckoutSubmit} className="space-y-5">
                <div>
                  <label className="mb-2 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                    PAYMENT METHOD
                  </label>
                  <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                    {(
                      [
                        { id: 'STRIPE' as const, icon: CreditCard, label: 'Stripe', sub: 'Card' },
                        {
                          id: 'MANUAL_BANK' as const,
                          icon: Building2,
                          label: 'Bank',
                          sub: 'Proof',
                        },
                        {
                          id: 'RESELLER' as const,
                          icon: MessageSquare,
                          label: 'Reseller',
                          sub: 'Contact',
                        },
                      ] as const
                    )
                      .filter((g) => enabledGateways[g.id])
                      .map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => setGateway(g.id)}
                        className={`rounded-xl border p-3 text-center transition-colors ${
                          gateway === g.id
                            ? 'border-[var(--a1)] bg-[var(--a1soft)]'
                            : 'border-[var(--line)] bg-[var(--bg2)] text-[var(--ink2)]'
                        }`}
                      >
                        <g.icon className="mx-auto mb-1.5 h-5 w-5 text-[var(--a1)]" />
                        <div className="text-xs font-semibold">{g.label}</div>
                        <div className="text-[10px] text-[var(--ink3)]">{g.sub}</div>
                      </button>
                    ))}
                  </div>
                  {!enabledGateways.STRIPE &&
                    !enabledGateways.MANUAL_BANK &&
                    !enabledGateways.RESELLER && (
                      <p className="mt-2 text-xs text-rose-400">
                        No payment gateways are enabled. Contact support.
                      </p>
                    )}
                </div>

                {gateway === 'STRIPE' && (
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg2)] p-4 text-[13px] text-[var(--ink2)]">
                    Instant activation via Stripe. Cards accepted.
                  </div>
                )}

                {gateway === 'MANUAL_BANK' && (
                  <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg2)] p-4 text-[13px]">
                    <pre className="whitespace-pre-wrap rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 font-mono text-[11px] text-[var(--ink2)]">
                      {bankDetails}
                    </pre>
                    <input
                      type="text"
                      required
                      value={bankReference}
                      onChange={(e) => setBankReference(e.target.value)}
                      placeholder="Transaction reference"
                      className="w-full rounded-[11px] border border-[var(--line)] bg-[var(--card)] px-3.5 py-2.5 text-sm outline-none focus:border-[var(--a1)]"
                    />
                    <input
                      type="file"
                      accept="image/*"
                      required
                      onChange={handleProofFileChange}
                      className="w-full text-xs text-[var(--ink3)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--a1)] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[var(--onA)]"
                    />
                    {uploadingProof && (
                      <p className="text-xs text-[var(--a2)]">Uploading…</p>
                    )}
                    {proofPreviewUrl && (
                      <p className="flex items-center gap-1.5 text-xs text-[var(--a1)]">
                        <Check className="h-3.5 w-3.5" /> Receipt uploaded
                      </p>
                    )}
                  </div>
                )}

                {gateway === 'RESELLER' && (
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg2)] p-4 text-[13px] leading-relaxed text-[var(--ink2)]">
                    {resellerMessage}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setSelectedPlan(null)}
                  >
                    Cancel
                  </button>
                  {gateway === 'RESELLER' ? null : (
                    <button
                      type="submit"
                      disabled={submittingOrder || uploadingProof}
                      className="btn-primary"
                    >
                      {submittingOrder
                        ? 'Processing…'
                        : gateway === 'STRIPE'
                          ? `Pay $${selectedPlan.priceMonthly}`
                          : 'Submit proof'}
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
