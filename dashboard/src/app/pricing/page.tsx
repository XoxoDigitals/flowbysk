'use client';

import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import PricingPlansGrid from '@/components/PricingPlansGrid';

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)]">
      <Navbar />
      <main>
        <section className="flow-container flex flex-col items-center gap-4 py-[clamp(48px,7vw,80px)] text-center">
          <span className="flow-label">PRICING</span>
          <h1 className="max-w-[720px] text-balance text-[clamp(36px,5.8vw,70px)] font-semibold leading-[0.98] tracking-[-0.045em]">
            Pick a plan, start rendering.
          </h1>
          <p className="max-w-[500px] text-pretty text-[18px] leading-[1.55] text-[var(--ink2)]">
            Self-serve, cancel any time. Plans sync from admin — what you edit there is what customers see.
          </p>
        </section>

        <section className="flow-container pb-20">
          <PricingPlansGrid ctaHref="/auth/register" />
        </section>

        <section className="flow-container pb-16 text-center">
          <p className="text-sm text-[var(--ink3)]">
            Need a custom volume deal?{' '}
            <Link href="/contact" className="font-medium text-[var(--a1)] hover:underline">
              Contact us
            </Link>
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
