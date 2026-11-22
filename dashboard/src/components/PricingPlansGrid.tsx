'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PublicPlan } from '@/lib/plans';

type Props = {
  /** Compact strip for homepage */
  compact?: boolean;
  ctaHref?: string;
  heading?: string;
  subheading?: string;
};

function isCreditFeatureLine(line: string) {
  return /credits?\s*\/\s*cycle/i.test(line);
}

export default function PricingPlansGrid({
  compact = false,
  ctaHref = '/auth/register',
  heading,
  subheading,
}: Props) {
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/plans')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setPlans(data?.plans || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="py-8 text-center text-sm text-[var(--ink3)]">Loading plans…</p>;
  }

  if (plans.length === 0) {
    return <p className="py-8 text-center text-sm text-[var(--ink3)]">No plans available.</p>;
  }

  const popularName = plans.find((p) => p.priceMonthly > 0)?.name;

  return (
    <div className="flex w-full flex-col gap-6">
      {(heading || subheading) && (
        <div className="flex flex-col items-center gap-2 text-center">
          {heading && (
            <h2 className="max-w-[720px] text-balance text-[clamp(28px,4vw,48px)] font-semibold leading-[1.02] tracking-[-0.04em]">
              {heading}
            </h2>
          )}
          {subheading && (
            <p className="max-w-[520px] text-pretty text-[15px] leading-relaxed text-[var(--ink2)] sm:text-[17px]">
              {subheading}
            </p>
          )}
        </div>
      )}

      <div
        className={`grid gap-3.5 ${
          compact ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-2 xl:grid-cols-4'
        }`}
      >
        {plans.map((p) => {
          const isPopular = p.name === popularName && p.priceMonthly > 0 && !p.contactSeller;
          const price = p.contactSeller
            ? 'Contact Your Seller'
            : p.priceMonthly <= 0
              ? 'Free'
              : `$${p.priceMonthly}`;
          const featureLines = (p.features || []).filter((f) => !isCreditFeatureLine(f));
          return (
            <div
              key={p.id}
              className={`flex flex-col gap-3 rounded-[18px] border p-5 ${
                isPopular
                  ? 'border-[var(--a1)] bg-[var(--a1soft)]'
                  : 'border-[var(--line)] bg-[var(--card)]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[15px] font-semibold tracking-[-0.02em]">{p.name}</h3>
                {isPopular && (
                  <span className="rounded-md bg-[var(--a1)] px-2 py-0.5 font-mono text-[9px] font-semibold text-[var(--onA)]">
                    POPULAR
                  </span>
                )}
              </div>

              {/* Credits highlighted under plan name */}
              <div className="flex flex-col gap-1 border-b border-[var(--line)] pb-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[clamp(28px,3vw,36px)] font-semibold leading-none tracking-[-0.04em] text-[var(--ink)]">
                    {p.standardCreditsCycle.toLocaleString()}
                  </span>
                  <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ink3)]">
                    std / cycle
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[clamp(22px,2.4vw,28px)] font-semibold leading-none tracking-[-0.03em] text-[var(--a1)]">
                    {p.proCreditsCycle.toLocaleString()}
                  </span>
                  <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--ink3)]">
                    pro / cycle
                  </span>
                </div>
              </div>

              <p
                className={`font-semibold tracking-[-0.03em] ${
                  p.contactSeller ? 'text-[18px] leading-snug' : 'font-mono text-[28px]'
                }`}
              >
                {price}
                {!p.contactSeller && p.priceMonthly > 0 && (
                  <span className="text-sm font-normal text-[var(--ink3)]">/mo</span>
                )}
              </p>
              {p.description && (
                <p className="text-[13px] leading-relaxed text-[var(--ink2)]">{p.description}</p>
              )}
              <ul className="mt-1 flex flex-1 flex-col gap-1.5">
                {featureLines.map((f) => (
                  <li key={f} className="flex gap-2 text-[13px] text-[var(--ink2)]">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--a1)]" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {!p.contactSeller && (
                <Link
                  href={ctaHref}
                  className={`mt-2 w-full !py-2.5 text-center text-[13px] ${
                    isPopular ? 'btn-primary' : 'btn-secondary'
                  }`}
                >
                  {p.priceMonthly <= 0 ? 'Start free' : `Choose ${p.name}`}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
