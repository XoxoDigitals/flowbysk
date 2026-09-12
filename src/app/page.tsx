import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import PricingPlansGrid from '@/components/PricingPlansGrid';

const gallery = [
  {
    label: 'PORTRAIT GEN',
    src: '/static/showcase/uc-baby-podcast.mp4',
  },
  {
    label: 'VEO CLIP · 8S',
    src: '/static/showcase/uc-baby-animal-interview.mp4',
  },
  {
    label: 'LANDSCAPE GEN',
    src: '/static/showcase/uc-baby-documentary.mp4',
  },
  {
    label: 'PRODUCT SHOT',
    src: '/static/showcase/uc-baby-snack-review.mp4',
  },
  {
    label: 'B-ROLL LOOP',
    src: '/static/showcase/uc-baby-chef.mp4',
  },
  {
    label: 'THUMBNAIL SET',
    src: '/static/showcase/uc-baby-podcast.mp4',
  },
];

const stats = [
  { n: '12K+', l: 'ACTIVE CREATORS' },
  { n: '3.4M', l: 'GENERATIONS DELIVERED' },
  { n: '99.9%', l: 'API UPTIME' },
  { n: '48s', l: 'AVG. RENDER TIME' },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)] text-[var(--ink)]">
      <Navbar />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden px-5 pb-16 pt-[clamp(56px,9vw,96px)]">
          <div
            className="pointer-events-none absolute inset-x-[15%] -top-[25%] bottom-[45%]"
            style={{
              background:
                'radial-gradient(60% 50% at 50% 45%, var(--a2soft), transparent 70%)',
            }}
          />
          <div className="relative mx-auto flex max-w-[1000px] flex-col items-center gap-[26px] text-center">
            <div className="font-mono flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] px-3.5 py-1.5 text-[11px] font-medium tracking-[0.08em] text-[var(--ink2)]">
              <span className="block h-1.5 w-1.5 rounded-full bg-[var(--a1)]" />
              OMNI FLASH + WHISK · NO EXTENSION NEEDED
            </div>
            <h1 className="text-balance text-[clamp(42px,7.2vw,90px)] font-semibold leading-[0.96] tracking-[-0.045em]">
              Cinema, on demand.
              <br />
              <span className="text-[var(--ink3)]">No rig. No render farm.</span>
            </h1>
            <p className="max-w-[560px] text-pretty text-[19px] leading-[1.55] text-[var(--ink2)]">
              Flowbysk gives solo creators direct API access to the best generative video and image
              models, in a studio that feels like Flow — no extension, no logouts, no setup.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link href="/auth/register" className="btn-primary !px-7 !py-[15px] !text-[15px]">
                Start free — 50 credits
              </Link>
              <Link href="/dashboard" className="btn-secondary !px-7 !py-[15px] !text-[15px]">
                Open dashboard
              </Link>
            </div>
            <p className="font-mono text-[11px] tracking-[0.08em] text-[var(--ink3)]">
              NO CARD REQUIRED · CANCEL ANY TIME
            </p>
          </div>
        </section>

        {/* Showcase clips */}
        <section className="flow-container pb-[72px]">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {gallery.map((item, i) => (
              <div
                key={item.label}
                className={`relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--bg2)] aspect-[3/4] ${
                  i % 2 === 1 ? 'mt-7' : ''
                }`}
              >
                <video
                  className="absolute inset-0 h-full w-full object-cover"
                  src={item.src}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  aria-label={item.label}
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                <span className="font-mono absolute inset-x-0 bottom-0 z-[1] p-2.5 text-center text-[10px] font-medium tracking-[0.08em] text-white">
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Stats */}
        <section className="border-y border-[var(--line)] bg-[var(--bg2)]">
          <div className="flow-container grid grid-cols-2 gap-8 py-11 lg:grid-cols-4">
            {stats.map((s) => (
              <div key={s.l} className="flex flex-col gap-1.5">
                <span className="text-[40px] font-semibold tracking-[-0.04em]">{s.n}</span>
                <span className="font-mono text-[11px] tracking-[0.1em] text-[var(--ink3)]">
                  {s.l}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Marquee */}
        <section className="overflow-hidden border-b border-[var(--line)] py-[22px]">
          <div className="flow-marquee font-mono flex w-max gap-14 whitespace-nowrap text-[13px] font-medium tracking-[0.12em] text-[var(--ink3)]">
            {[0, 1, 2].map((k) => (
              <span key={k} className="flex gap-14">
                <span className="text-[var(--a1)]">OMNI FLASH</span>
                <span className="text-[var(--a1)]">WHISK</span>
                <span>VEO 3.1</span>
                <span>IMAGEN 4</span>
                <span>NANO BANANA 2 PRO</span>
                <span>GOOGLE FLOW</span>
              </span>
            ))}
          </div>
        </section>

        {/* Omni + Whisk */}
        <section className="flow-container pt-[72px]">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-[20px] border border-[var(--a1)] bg-[var(--card)] p-[clamp(24px,3vw,34px)]">
              <span className="font-mono w-fit rounded-full bg-[var(--a1)] px-2.5 py-1 text-[10px] font-semibold tracking-[0.1em] text-[var(--onA)]">
                ONLY ON FLOWBYSK
              </span>
              <h3 className="text-[clamp(22px,2.6vw,28px)] font-semibold tracking-[-0.03em]">
                Omni Flash
              </h3>
              <p className="text-pretty text-[15px] leading-[1.65] text-[var(--ink2)]">
                The fastest multimodal generation lane — text, image and video from a single prompt,
                in seconds.
              </p>
              <div className="mt-auto flex flex-wrap gap-5 border-t border-[var(--line)] pt-4">
                <span className="flex flex-col gap-1">
                  <span className="text-lg font-semibold">~6s</span>
                  <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                    TO FIRST FRAME
                  </span>
                </span>
                <span className="flex flex-col gap-1">
                  <span className="text-lg font-semibold">20 CR</span>
                  <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                    PER GENERATION
                  </span>
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-3 rounded-[20px] border border-[var(--a2)] bg-[var(--card)] p-[clamp(24px,3vw,34px)]">
              <span className="font-mono w-fit rounded-full bg-[var(--a2)] px-2.5 py-1 text-[10px] font-semibold tracking-[0.1em] text-[var(--onA)]">
                ALSO EXCLUSIVE
              </span>
              <h3 className="text-[clamp(22px,2.6vw,28px)] font-semibold tracking-[-0.03em]">Whisk</h3>
              <p className="text-pretty text-[15px] leading-[1.65] text-[var(--ink2)]">
                Remix by image, not by words. Drop in a subject, a scene and a style — the fastest way
                to lock a look before you render.
              </p>
              <div className="mt-auto flex flex-wrap gap-5 border-t border-[var(--line)] pt-4">
                <span className="flex flex-col gap-1">
                  <span className="text-lg font-semibold">3 refs</span>
                  <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                    SUBJECT · SCENE · STYLE
                  </span>
                </span>
                <span className="flex flex-col gap-1">
                  <span className="text-lg font-semibold">6 CR</span>
                  <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                    PER REMIX
                  </span>
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* No extension */}
        <section className="flow-container py-[clamp(48px,7vw,80px)]">
          <div className="mb-7 flex max-w-[600px] flex-col gap-3">
            <span className="flow-label">NO EXTENSION</span>
            <h2 className="text-balance text-[clamp(28px,3.8vw,44px)] font-semibold leading-[1.02] tracking-[-0.035em]">
              Everyone else ships a browser extension. We built the API.
            </h2>
            <p className="max-w-[520px] text-pretty text-base leading-relaxed text-[var(--ink2)]">
              Extension-based tools borrow a browser session — so they log you out and break on host
              updates. Flowbysk generates through its own API.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-3.5 rounded-[20px] border border-dashed border-[var(--line2)] p-[clamp(22px,3vw,30px)]">
              <span className="font-mono text-[10px] font-medium tracking-[0.12em] text-[var(--ink3)]">
                EXTENSION-BASED TOOLS
              </span>
              {[
                'Random logouts mid-project',
                'Shared sessions that drop under load',
                'Chrome only, developer mode required',
                'Breaks every time the host UI ships',
                'Credentials sitting in your browser',
              ].map((t) => (
                <span key={t} className="text-[15px] text-[var(--ink2)]">
                  {t}
                </span>
              ))}
            </div>
            <div className="flex flex-col gap-3.5 rounded-[20px] border border-[var(--a1)] bg-[var(--card)] p-[clamp(22px,3vw,30px)]">
              <span className="font-mono text-[10px] font-medium tracking-[0.12em] text-[var(--a1)]">
                FLOWBYSK · API-BASED
              </span>
              {[
                'Signed in until you sign out',
                'Your own quota, never a shared pool',
                'Any browser, any device, any OS',
                'Nothing to install or reload',
                'Keys stay server-side, always',
              ].map((t) => (
                <span key={t} className="text-[15px]">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* Steps */}
        <section className="flow-container pb-[72px]">
          <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
            <div className="flex flex-col gap-[18px]">
              <span className="flow-label">03 STEPS</span>
              <h2 className="text-balance text-[clamp(30px,4vw,48px)] font-semibold leading-[1.02] tracking-[-0.035em]">
                From sign-up to first render in five minutes.
              </h2>
              <p className="max-w-[400px] text-[17px] leading-relaxed text-[var(--ink2)]">
                No extension, no logouts, no waiting on a regional rollout.
              </p>
            </div>
            <div className="flex flex-col">
              {[
                {
                  n: '01',
                  t: 'Create your account',
                  d: 'Sign up with email and welcome credits land in your balance.',
                },
                {
                  n: '02',
                  t: 'Open the studio',
                  d: 'No extension to install. Sign in and it works.',
                },
                {
                  n: '03',
                  t: 'Generate and download',
                  d: 'Write a prompt, pick a model, pull finished clips from your history.',
                },
              ].map((s, i) => (
                <div
                  key={s.n}
                  className={`flex gap-[22px] border-t border-[var(--line)] py-[26px] ${
                    i === 2 ? 'border-b' : ''
                  }`}
                >
                  <span className="font-mono pt-1 text-[13px] text-[var(--ink3)]">{s.n}</span>
                  <div className="flex flex-col gap-1.5">
                    <h3 className="text-xl font-semibold tracking-[-0.02em]">{s.t}</h3>
                    <p className="text-[15px] leading-relaxed text-[var(--ink2)]">{s.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Feature cards */}
        <section className="flow-container pb-[72px]">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
            <div className="flex max-w-[520px] flex-col gap-3">
              <span className="flow-label">EXCLUSIVE · WHAT YOU GET</span>
              <h2 className="text-balance text-[clamp(28px,3.8vw,44px)] font-semibold leading-[1.02] tracking-[-0.035em]">
                Frontier models, direct API access, one readable ledger.
              </h2>
            </div>
            <Link href="/features" className="btn-secondary">
              All features
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              {
                soft: 'a1',
                t: 'AI video generation',
                d: 'Cinematic clips through Veo 3.1, with camera moves written into the prompt.',
              },
              {
                soft: 'a2',
                t: 'Stills that hold up',
                d: 'Nano Banana and image models for photoreal or stylised frames, at any ratio.',
              },
              {
                soft: 'a1',
                t: 'Native API, no extension',
                d: 'Direct API generation in a Flow-like studio — never a logout mid-render.',
              },
              {
                soft: 'a2',
                t: 'Credits, not invoices',
                d: 'Cost shown before you spend. Failed renders refund automatically.',
              },
            ].map((f) => (
              <div key={f.t} className="flow-card flex flex-col gap-2.5 p-[26px]">
                <span
                  className="mb-1 block h-8 w-8 rounded-[10px] border border-[var(--line)]"
                  style={{
                    background: f.soft === 'a1' ? 'var(--a1soft)' : 'var(--a2soft)',
                  }}
                />
                <h3 className="text-[19px] font-semibold tracking-[-0.02em]">{f.t}</h3>
                <p className="text-sm leading-relaxed text-[var(--ink2)]">{f.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section className="flow-container pb-[72px]">
          <PricingPlansGrid
            compact
            heading="Plans that scale with your output"
            subheading="Live from your admin Plans — edit credits, slots, and features once and they show everywhere."
            ctaHref="/auth/register"
          />
          <div className="mt-6 flex justify-center">
            <Link href="/pricing" className="text-[13px] font-medium text-[var(--a1)] hover:underline">
              Compare full pricing →
            </Link>
          </div>
        </section>

        {/* CTA */}
        <section className="flow-container pb-20">
          <div className="flex flex-col items-center gap-5 rounded-[24px] border border-[var(--line)] bg-gradient-to-br from-[var(--card)] to-[var(--bg2)] px-8 py-[clamp(40px,6vw,76px)] text-center">
            <h2 className="max-w-[620px] text-balance text-[clamp(30px,4.6vw,52px)] font-semibold leading-[1.02] tracking-[-0.04em]">
              Your next scene is one prompt away.
            </h2>
            <p className="max-w-[440px] text-[17px] leading-relaxed text-[var(--ink2)]">
              Start on the free tier. Upgrade when your output outgrows it.
            </p>
            <Link href="/pricing" className="btn-primary !px-[30px] !py-[15px] !text-[15px]">
              See plans
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
