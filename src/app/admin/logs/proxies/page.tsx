'use client';

import { useCallback, useEffect, useState } from 'react';
import NextLink from 'next/link';
import {
  RefreshCw,
  Globe,
  Save,
  Zap,
  Activity,
  ArrowLeft,
  ShieldAlert,
} from 'lucide-react';

const inputClass =
  'w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] outline-none focus:border-[var(--a1)]';

const COUNTRY_PRESETS = [
  'us', 'gb', 'de', 'fr', 'nl', 'ca', 'au', 'es', 'it', 'pl', 'se', 'br', 'jp', 'sg', 'in',
];

type DiSettings = {
  enabled: boolean;
  proxyLogin: string;
  proxyPasswordSet: boolean;
  proxyPasswordMasked: string;
  apiTokenSet: boolean;
  apiTokenMasked: string;
  countries: string[];
  stickyPortBase: number;
  sessttlMinutes: number;
  autoAssignOnLaunch: boolean;
  accountCount: number;
  updatedAt: string | null;
};

type Usage = {
  ok: boolean;
  balance?: number;
  trafficLeftGb?: number;
  trafficUsedGb?: number;
  error?: string;
  fetchedAt?: string;
};

type LeaderRow = {
  country: string;
  ok: number;
  fail: number;
  unusual: number;
  throttle: number;
  tunnel: number;
  total: number;
  successRate: number;
  unusualRate: number;
  score: number;
};

type Assignment = {
  accountId: string;
  country: string;
  sessId: string;
  port: number;
  gen: number;
  updatedAt?: string;
};

export default function AdminProxyStatsPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<DiSettings | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([]);
  const [recent, setRecent] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  // Form fields
  const [enabled, setEnabled] = useState(false);
  const [proxyLogin, setProxyLogin] = useState('');
  const [proxyPassword, setProxyPassword] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [countries, setCountries] = useState<string[]>(['us', 'gb', 'de']);
  const [sessttl, setSessttl] = useState(60);
  const [portBase, setPortBase] = useState(10000);
  const [autoAssign, setAutoAssign] = useState(true);
  const [countryDraft, setCountryDraft] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json().catch(() => ({}));
        const role = data?.user?.role || data?.role || '';
        setAllowed(role === 'SUPER_ADMIN');
      } catch {
        setAllowed(false);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    if (allowed !== true) return;
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`/api/admin/dataimpulse?usage=1&stats=1&days=${days}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      const s = data.settings as DiSettings;
      setSettings(s);
      setEnabled(!!s.enabled);
      setProxyLogin(s.proxyLogin || '');
      setProxyPassword('');
      setApiToken('');
      setCountries(Array.isArray(s.countries) ? s.countries : ['us']);
      setSessttl(s.sessttlMinutes || 60);
      setPortBase(s.stickyPortBase || 10000);
      setAutoAssign(s.autoAssignOnLaunch !== false);
      setUsage(data.usage || null);
      setLeaderboard(data.stats?.leaderboard || []);
      setRecent(data.stats?.recent || []);
      setAssignments(data.assignments || []);
    } catch (e: any) {
      setErr(e?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [allowed, days]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(reassignLive = false) {
    setSaving(true);
    setMsg('');
    setErr('');
    try {
      const body: Record<string, unknown> = {
        enabled,
        proxyLogin,
        countries,
        stickyPortBase: portBase,
        sessttlMinutes: sessttl,
        autoAssignOnLaunch: autoAssign,
        reassignLive,
      };
      if (proxyPassword.trim()) body.proxyPassword = proxyPassword.trim();
      if (apiToken.trim()) body.apiToken = apiToken.trim();

      const res = await fetch('/api/admin/dataimpulse', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setMsg(
        reassignLive
          ? `Saved · reassigned ${data.reassigned || 0} live account(s)`
          : 'Saved DataImpulse settings'
      );
      setProxyPassword('');
      setApiToken('');
      await load();
    } catch (e: any) {
      setErr(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setMsg('');
    setErr('');
    try {
      const res = await fetch('/api/admin/dataimpulse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', country: countries[0] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Connection test failed');
      }
      setMsg(
        `OK · IP ${data.ip || '?'} · ${data.countryCode || data.country || countries[0]} · ${data.urlMasked || ''}`
      );
    } catch (e: any) {
      setErr(e?.message || 'Test failed');
    } finally {
      setTesting(false);
    }
  }

  function toggleCountry(c: string) {
    const code = c.toLowerCase();
    setCountries((prev) =>
      prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]
    );
  }

  function addCountryDraft() {
    const code = countryDraft.trim().toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
    if (code.length === 2 && !countries.includes(code)) {
      setCountries((prev) => [...prev, code]);
    }
    setCountryDraft('');
  }

  if (allowed === null) {
    return (
      <div className="p-6 text-sm text-[var(--ink3)]">Checking access…</div>
    );
  }

  if (allowed === false) {
    return (
      <div className="flex flex-col items-center gap-3 p-12 text-center">
        <ShieldAlert className="h-8 w-8 text-rose-500" />
        <p className="text-sm text-[var(--ink)]">SUPER_ADMIN only</p>
        <NextLink href="/admin" className="text-xs text-[var(--a1)] underline">
          Back to admin
        </NextLink>
      </div>
    );
  }

  const leftGb = usage?.trafficLeftGb ?? usage?.balance;
  const usedGb = usage?.trafficUsedGb;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <NextLink
            href="/admin/logs"
            className="inline-flex items-center gap-1 text-xs text-[var(--ink3)] hover:text-[var(--ink)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> PM2 Logs
          </NextLink>
          <h1 className="text-lg font-semibold text-[var(--ink)]">DataImpulse / Proxy</h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            className={inputClass + ' w-auto'}
            value={days}
            onChange={(e) => setDays(Number(e.target.value) || 7)}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button
            type="button"
            onClick={() => load()}
            className="inline-flex items-center gap-1.5 rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-xs text-[var(--ink)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {(msg || err) && (
        <div
          className={`rounded-[11px] px-3 py-2 text-xs ${
            err ? 'bg-rose-500/10 text-rose-500' : 'bg-[var(--a1soft)] text-[var(--a1)]'
          }`}
        >
          {err || msg}
        </div>
      )}

      {/* Plan usage */}
      <section className="rounded-[14px] border border-[var(--line)] bg-[var(--bg2)] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
          <Activity className="h-4 w-4 text-[var(--a1)]" />
          Plan usage
        </div>
        {!usage?.ok ? (
          <p className="text-xs text-[var(--ink3)]">
            {usage?.error || 'Add User API token below to see remaining traffic.'}
            {usage?.error?.includes('TRAFFIC') ? ' Tip: 407 TRAFFIC_EXHAUSTED means top up the plan.' : ''}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--ink3)]">Remaining</div>
              <div className="text-xl font-semibold text-[var(--ink)]">
                {leftGb != null ? `${Number(leftGb).toFixed(2)} GB` : '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--ink3)]">Used</div>
              <div className="text-xl font-semibold text-[var(--ink)]">
                {usedGb != null ? `${Number(usedGb).toFixed(2)} GB` : '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--ink3)]">Synced</div>
              <div className="text-sm text-[var(--ink2)]">
                {usage.fetchedAt ? new Date(usage.fetchedAt).toLocaleString() : '—'}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Credentials */}
      <section className="rounded-[14px] border border-[var(--line)] bg-[var(--bg2)] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
            <Globe className="h-4 w-4 text-[var(--a1)]" />
            Residential gateway
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--ink2)]">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enabled
          </label>
        </div>
        <p className="mb-3 text-xs text-[var(--ink3)]">
          Sticky residential via <code className="text-[var(--ink2)]">gw.dataimpulse.com</code> with
          country + sessid. When enabled, BiB launch and rotate use DataImpulse instead of the static
          egress list (fallback when disabled).
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-[var(--ink3)]">
            Proxy login
            <input
              className={inputClass + ' mt-1'}
              value={proxyLogin}
              onChange={(e) => setProxyLogin(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="block text-xs text-[var(--ink3)]">
            Proxy password {settings?.proxyPasswordSet ? '(set)' : ''}
            <input
              className={inputClass + ' mt-1'}
              type="password"
              value={proxyPassword}
              onChange={(e) => setProxyPassword(e.target.value)}
              placeholder={settings?.proxyPasswordSet ? '••••••••' : ''}
              autoComplete="new-password"
            />
          </label>
          <label className="block text-xs text-[var(--ink3)] sm:col-span-2">
            User API token (plan usage) {settings?.apiTokenSet ? '(set)' : ''}
            <input
              className={inputClass + ' mt-1'}
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder={settings?.apiTokenSet ? '••••••••' : 'Bearer from dashboard API Management'}
              autoComplete="new-password"
            />
          </label>
          <label className="block text-xs text-[var(--ink3)]">
            Sticky TTL (minutes)
            <input
              className={inputClass + ' mt-1'}
              type="number"
              min={1}
              max={120}
              value={sessttl}
              onChange={(e) => setSessttl(Number(e.target.value) || 60)}
            />
          </label>
          <label className="block text-xs text-[var(--ink3)]">
            Sticky port base (unique: 10000, 10001, …)
            <input
              className={inputClass + ' mt-1'}
              type="number"
              min={10000}
              max={19999}
              value={portBase}
              onChange={(e) => setPortBase(Number(e.target.value) || 10000)}
            />
          </label>
        </div>

        <div className="mt-4">
          <div className="mb-2 text-xs text-[var(--ink3)]">Countries (ISO2 allowlist)</div>
          <div className="flex flex-wrap gap-1.5">
            {COUNTRY_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggleCountry(c)}
                className={`rounded-md px-2 py-1 font-mono text-[11px] uppercase ${
                  countries.includes(c)
                    ? 'bg-[var(--a1)] text-white'
                    : 'border border-[var(--line)] bg-[var(--bg)] text-[var(--ink3)]'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className={inputClass + ' max-w-[100px]'}
              placeholder="xx"
              value={countryDraft}
              maxLength={2}
              onChange={(e) => setCountryDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCountryDraft())}
            />
            <button
              type="button"
              onClick={addCountryDraft}
              className="rounded-[11px] border border-[var(--line)] px-3 text-xs text-[var(--ink2)]"
            >
              Add
            </button>
            <span className="self-center text-[11px] text-[var(--ink3)]">
              Active: {countries.join(', ').toUpperCase() || 'none'}
            </span>
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2 text-xs text-[var(--ink2)]">
          <input
            type="checkbox"
            checked={autoAssign}
            onChange={(e) => setAutoAssign(e.target.checked)}
          />
          Auto-assign sticky IP on BiB launch
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => save(false)}
            className="inline-flex items-center gap-1.5 rounded-[11px] bg-[var(--a1)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </button>
          <button
            type="button"
            disabled={saving || !enabled}
            onClick={() => save(true)}
            className="inline-flex items-center gap-1.5 rounded-[11px] border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--ink)] disabled:opacity-50"
          >
            Save + reassign live
          </button>
          <button
            type="button"
            disabled={testing}
            onClick={testConnection}
            className="inline-flex items-center gap-1.5 rounded-[11px] border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--ink)] disabled:opacity-50"
          >
            <Zap className="h-3.5 w-3.5" />
            {testing ? 'Testing…' : 'Test connection'}
          </button>
        </div>
      </section>

      {/* Country leaderboard */}
      <section className="rounded-[14px] border border-[var(--line)] bg-[var(--bg2)] p-4">
        <div className="mb-3 text-sm font-medium text-[var(--ink)]">Country quality</div>
        {leaderboard.length === 0 ? (
          <p className="text-xs text-[var(--ink3)]">No outcome events yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--line)] text-[var(--ink3)]">
                  <th className="py-2 pr-3 font-medium">Country</th>
                  <th className="py-2 pr-3 font-medium">OK</th>
                  <th className="py-2 pr-3 font-medium">Fail</th>
                  <th className="py-2 pr-3 font-medium">Unusual</th>
                  <th className="py-2 pr-3 font-medium">Success %</th>
                  <th className="py-2 pr-3 font-medium">Unusual %</th>
                  <th className="py-2 font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row) => (
                  <tr key={row.country} className="border-b border-[var(--line)]/60 text-[var(--ink)]">
                    <td className="py-2 pr-3 font-mono uppercase">{row.country}</td>
                    <td className="py-2 pr-3">{row.ok}</td>
                    <td className="py-2 pr-3">{row.fail + row.tunnel}</td>
                    <td className="py-2 pr-3">{row.unusual + row.throttle}</td>
                    <td className="py-2 pr-3">{(row.successRate * 100).toFixed(0)}%</td>
                    <td className="py-2 pr-3">{(row.unusualRate * 100).toFixed(0)}%</td>
                    <td className="py-2">{row.score.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Assignments + recent */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--bg2)] p-4">
          <div className="mb-3 text-sm font-medium text-[var(--ink)]">
            Assignments ({assignments.length})
          </div>
          {assignments.length === 0 ? (
            <p className="text-xs text-[var(--ink3)]">None yet — launch a BiB account after enabling.</p>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto text-xs">
              {assignments.map((a) => (
                <li key={a.accountId} className="flex justify-between gap-2 font-mono text-[var(--ink2)]">
                  <span>{a.accountId.slice(0, 8)}…</span>
                  <span className="uppercase text-[var(--ink)]">
                    {a.country}:{a.port} g{a.gen}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-[14px] border border-[var(--line)] bg-[var(--bg2)] p-4">
          <div className="mb-3 text-sm font-medium text-[var(--ink)]">Recent events</div>
          {recent.length === 0 ? (
            <p className="text-xs text-[var(--ink3)]">No metrics yet.</p>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto text-[11px] text-[var(--ink2)]">
              {recent.map((e, i) => (
                <li key={`${e.at}-${i}`} className="flex justify-between gap-2">
                  <span>
                    <span className="font-mono uppercase text-[var(--ink)]">{e.country || '?'}</span>{' '}
                    {e.event}
                  </span>
                  <span className="shrink-0 text-[var(--ink3)]">
                    {e.at ? new Date(e.at).toLocaleString() : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="text-[11px] text-[var(--ink3)]">
        Static egress list remains under{' '}
        <NextLink href="/admin/settings" className="text-[var(--a1)] underline">
          Settings
        </NextLink>{' '}
        as fallback when DataImpulse is disabled.
      </p>
    </div>
  );
}
