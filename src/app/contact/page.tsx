'use client';

import { FormEvent, useState } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { useSiteSettings } from '@/components/SiteSettingsProvider';

export default function ContactPage() {
  const { contactEmail } = useSiteSettings();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('Plans and billing');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, subject, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setSent(true);
    } catch (err: any) {
      setError(err.message || 'Failed to send');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)]">
      <Navbar />
      <main className="flow-container py-[clamp(48px,7vw,80px)]">
        <div className="grid items-start gap-14 lg:grid-cols-2">
          <div className="flex flex-col gap-5">
            <span className="flow-label">CONTACT</span>
            <h1 className="text-balance text-[clamp(32px,5vw,56px)] font-semibold leading-none tracking-[-0.04em]">
              Tell us what you&apos;re making.
            </h1>
            <p className="max-w-[400px] text-pretty text-[17px] leading-relaxed text-[var(--ink2)]">
              Plan questions, billing, volume credits, or a bug you hit at 2am — we reply within one
              business day.
            </p>
            <div className="mt-2 flex flex-col">
              <div className="flex flex-col gap-1 border-t border-[var(--line)] py-[18px]">
                <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">SALES</span>
                <span className="text-base">{contactEmail || 'sales@flowbysk.com'}</span>
              </div>
              <div className="flex flex-col gap-1 border-t border-[var(--line)] py-[18px]">
                <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                  SUPPORT
                </span>
                <span className="text-base">{contactEmail || 'help@flowbysk.com'}</span>
              </div>
              <div className="flex flex-col gap-1 border-y border-[var(--line)] py-[18px]">
                <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                  COMMUNITY
                </span>
                <span className="text-base">Discord · creators</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-[18px] rounded-[22px] border border-[var(--line)] bg-[var(--card)] p-[clamp(26px,4vw,40px)]">
            {sent ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--a1soft)] text-lg text-[var(--a1)]">
                  ✓
                </span>
                <h3 className="text-xl font-semibold tracking-[-0.02em]">Message sent</h3>
                <p className="max-w-[300px] text-[15px] leading-relaxed text-[var(--ink2)]">
                  We&apos;ll be in touch at the address you gave us within one business day.
                </p>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="flex flex-col gap-[18px]">
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                      NAME
                    </span>
                    <input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      className="rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3.5 py-3 text-[15px] text-[var(--ink)] outline-none focus:border-[var(--a1)]"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                      EMAIL
                    </span>
                    <input
                      required
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@studio.com"
                      className="rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3.5 py-3 text-[15px] text-[var(--ink)] outline-none focus:border-[var(--a1)]"
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                    TOPIC
                  </span>
                  <select
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3.5 py-3 text-[15px] text-[var(--ink)] outline-none focus:border-[var(--a1)]"
                  >
                    <option>Plans and billing</option>
                    <option>Technical support</option>
                    <option>Volume credits</option>
                    <option>Partnership</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                    MESSAGE
                  </span>
                  <textarea
                    required
                    rows={5}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="What are you working on?"
                    className="resize-y rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3.5 py-3 text-[15px] leading-relaxed text-[var(--ink)] outline-none focus:border-[var(--a1)]"
                  />
                </label>
                {error && <p className="text-sm text-rose-400">{error}</p>}
                <button type="submit" disabled={loading} className="btn-primary w-full !py-3.5">
                  {loading ? 'Sending…' : 'Send message'}
                </button>
                <p className="text-center text-xs text-[var(--ink3)]">
                  We only use your details to reply. No lists, no resale.
                </p>
              </form>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
