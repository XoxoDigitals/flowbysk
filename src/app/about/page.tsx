import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)]">
      <Navbar />
      <main>
        <section className="flow-container py-[clamp(48px,7vw,80px)]">
          <div className="mx-auto flex max-w-[900px] flex-col gap-[22px]">
            <span className="flow-label">ABOUT</span>
            <h1 className="text-balance text-[clamp(32px,5vw,58px)] font-semibold leading-[1.02] tracking-[-0.04em]">
              Access to frontier models shouldn&apos;t depend on where you live.
            </h1>
            <p className="max-w-[640px] text-pretty text-[19px] leading-relaxed text-[var(--ink2)]">
              Flowbysk started because the best video model on earth shipped to a handful of countries
              and billing systems. We built the layer that closes the gap — a managed session pool, a
              readable credit ledger, and a dashboard that treats solo creators like professionals.
            </p>
          </div>
        </section>

        <section className="flow-container pb-[68px]">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="font-mono flex aspect-[4/5] items-center justify-center rounded-[18px] border border-[var(--line)] bg-[repeating-linear-gradient(135deg,var(--bg2)_0_9px,var(--card)_9px_18px)] text-[10px] tracking-[0.08em] text-[var(--ink3)]">
              TEAM PHOTO
            </div>
            <div className="font-mono flex aspect-[8/5] items-center justify-center rounded-[18px] border border-[var(--line)] bg-[repeating-linear-gradient(135deg,var(--bg2)_0_9px,var(--card)_9px_18px)] text-[10px] tracking-[0.08em] text-[var(--ink3)] md:col-span-2 md:aspect-auto md:min-h-[280px]">
              STUDIO / WORKSPACE
            </div>
          </div>
        </section>

        <section className="flow-container pb-[68px]">
          <div className="grid items-start gap-14 lg:grid-cols-2">
            <div className="flex flex-col gap-3.5">
              <h2 className="text-[clamp(26px,3.6vw,42px)] font-semibold leading-[1.04] tracking-[-0.035em]">
                What we hold ourselves to
              </h2>
              <p className="max-w-[380px] text-base leading-relaxed text-[var(--ink2)]">
                Three commitments, written down so you can hold us to them too.
              </p>
            </div>
            <div className="flex flex-col">
              {[
                {
                  t: 'Your work stays yours',
                  d: 'We never train on, resell, or showcase your generations without written permission.',
                },
                {
                  t: 'No surprise ledgers',
                  d: 'Every deduction is itemised. Failed renders refund automatically.',
                },
                {
                  t: 'Humans on support',
                  d: 'Real people who have used the tools they are supporting.',
                },
              ].map((item, i) => (
                <div
                  key={item.t}
                  className={`flex flex-col gap-1.5 border-t border-[var(--line)] py-6 ${
                    i === 2 ? 'border-b' : ''
                  }`}
                >
                  <h3 className="text-[19px] font-semibold tracking-[-0.02em]">{item.t}</h3>
                  <p className="text-[15px] leading-relaxed text-[var(--ink2)]">{item.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-[var(--line)] bg-[var(--bg2)]">
          <div className="flow-container grid grid-cols-2 gap-8 py-[52px] lg:grid-cols-4">
            {[
              ['2024', 'FOUNDED'],
              ['14', 'PEOPLE'],
              ['31', 'COUNTRIES SERVED'],
              ['24/7', 'API MONITORING'],
            ].map(([n, l]) => (
              <div key={l} className="flex flex-col gap-1.5">
                <span className="text-[36px] font-semibold tracking-[-0.04em]">{n}</span>
                <span className="font-mono text-[11px] tracking-[0.1em] text-[var(--ink3)]">{l}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="flow-container py-16 text-center">
          <Link href="/contact" className="btn-primary">
            Talk to us
          </Link>
        </section>
      </main>
      <Footer />
    </div>
  );
}
