import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const features = [
  {
    soft: 'a1',
    t: 'AI video generation',
    d: 'Cinematic 8-second clips through Veo 3.1, with camera moves and style direction written straight into the prompt.',
  },
  {
    soft: 'a2',
    t: 'Stills that hold up',
    d: 'Image models for photoreal or stylised frames — portraits, packshots, key art, any ratio.',
  },
  {
    soft: 'a1',
    t: 'Credits, not invoices',
    d: 'One balance across every model. Cost is shown before you spend, and failed renders refund automatically.',
  },
  {
    soft: 'a2',
    t: 'API-based generation',
    d: 'Every render goes straight to the model over our own API — no browser session to expire.',
  },
  {
    soft: 'a1',
    t: 'A Flow-like studio',
    d: 'The interface you already know, running on our infrastructure. Nothing to install.',
  },
  {
    soft: 'a2',
    t: 'Support that answers',
    d: 'Paid plans get a private channel with fast first reply, including overnight.',
  },
];

const models = [
  { m: 'Omni Flash', o: 'Multimodal', c: '20', p: 'Paid plans', exclusive: 'a1' },
  { m: 'Whisk', o: 'Image remix', c: '6', p: 'Paid plans', exclusive: 'a2' },
  { m: 'Veo 3.1 Lite', o: 'Video · 8s', c: '10–15', p: 'All plans' },
  { m: 'Veo 3.1 Fast', o: 'Video · 8s', c: '40', p: 'Pro credits' },
  { m: 'Nano Banana 2', o: 'Image', c: '3', p: 'All plans' },
  { m: 'Nano Banana Pro', o: 'Image · Pro', c: '5', p: 'All plans' },
];

export default function FeaturesPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)]">
      <Navbar />
      <main>
        <section className="flow-container border-b border-[var(--line)] py-[clamp(48px,7vw,80px)]">
          <div className="flex max-w-[800px] flex-col gap-[18px]">
            <span className="flow-label">FEATURES</span>
            <h1 className="text-balance text-[clamp(36px,5.8vw,70px)] font-semibold leading-[0.98] tracking-[-0.045em]">
              Everything a production needs, minus the production.
            </h1>
            <p className="max-w-[540px] text-pretty text-[19px] leading-[1.55] text-[var(--ink2)]">
              Frontier models over our own API, a Flow-like studio, and a credit ledger you can
              actually read.
            </p>
          </div>
        </section>

        <section className="flow-container px-0 sm:px-0">
          <div className="mx-auto grid max-w-[1550px] sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <div
                key={f.t}
                className={`flex flex-col gap-2.5 border-b border-[var(--line)] p-10 px-[34px] ${
                  i % 3 !== 2 ? 'lg:border-r' : ''
                } ${i % 2 === 0 ? 'sm:border-r lg:border-r' : 'sm:border-r-0'} lg:border-r-[var(--line)]`}
                style={{
                  borderRightWidth: undefined,
                }}
              >
                <span
                  className="mb-1.5 block h-[34px] w-[34px] rounded-[10px] border border-[var(--line)]"
                  style={{ background: f.soft === 'a1' ? 'var(--a1soft)' : 'var(--a2soft)' }}
                />
                <h3 className="text-[21px] font-semibold tracking-[-0.02em]">{f.t}</h3>
                <p className="text-[15px] leading-relaxed text-[var(--ink2)]">{f.d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="flow-container py-[clamp(48px,7vw,80px)]">
          <h2 className="mb-6 text-[clamp(26px,3.6vw,40px)] font-semibold tracking-[-0.035em]">
            The model lineup
          </h2>
          <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--card)]">
            <div className="font-mono hidden grid-cols-[1.6fr_1fr_1fr_1fr] gap-3 border-b border-[var(--line)] bg-[var(--bg2)] px-[22px] py-[15px] text-[10px] font-medium tracking-[0.1em] text-[var(--ink3)] sm:grid">
              <span>MODEL</span>
              <span>OUTPUT</span>
              <span>CREDITS</span>
              <span>PLAN</span>
            </div>
            {models.map((row) => (
              <div
                key={row.m}
                className="grid grid-cols-1 gap-2 border-b border-[var(--line)] px-[22px] py-[18px] last:border-b-0 sm:grid-cols-[1.6fr_1fr_1fr_1fr] sm:items-center sm:gap-3"
                style={{
                  background: row.exclusive
                    ? row.exclusive === 'a1'
                      ? 'var(--a1soft)'
                      : 'var(--a2soft)'
                    : undefined,
                }}
              >
                <span className="flex flex-wrap items-center gap-2 text-base font-semibold">
                  {row.m}
                  {row.exclusive && (
                    <span
                      className="font-mono rounded-md px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.08em] text-[var(--onA)]"
                      style={{
                        background: row.exclusive === 'a1' ? 'var(--a1)' : 'var(--a2)',
                      }}
                    >
                      EXCLUSIVE
                    </span>
                  )}
                </span>
                <span className="text-sm text-[var(--ink2)]">{row.o}</span>
                <span className="font-mono text-sm text-[var(--ink2)]">{row.c}</span>
                <span className="text-[13px] text-[var(--ink3)]">{row.p}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="flow-container pb-20">
          <div className="grid items-center gap-11 rounded-[24px] border border-[var(--line)] bg-[var(--card)] p-[clamp(30px,5vw,60px)] lg:grid-cols-2">
            <div className="flex flex-col gap-3.5">
              <h2 className="text-[clamp(26px,3.4vw,38px)] font-semibold leading-[1.06] tracking-[-0.035em]">
                Built for people with deadlines
              </h2>
              <p className="text-pretty text-base leading-relaxed text-[var(--ink2)]">
                Priority queues, a history that never clears, and a dashboard that tells you exactly
                how many renders you have left.
              </p>
              <Link href="/dashboard" className="btn-secondary mt-2 self-start">
                Open dashboard
              </Link>
            </div>
            <div className="font-mono flex aspect-video items-center justify-center rounded-2xl border border-[var(--line)] bg-[repeating-linear-gradient(135deg,var(--bg2)_0_9px,var(--card2)_9px_18px)] text-[11px] tracking-[0.08em] text-[var(--ink3)]">
              PRODUCT SCREENSHOT
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
