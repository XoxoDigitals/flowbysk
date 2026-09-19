'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  Settings,
  MessageSquare,
  Building2,
  Save,
  Plus,
  Trash2,
  Power,
  Wrench,
  Server,
} from 'lucide-react';
import { useSiteSettings } from '@/components/SiteSettingsProvider';
import { SOCIAL_PLATFORMS, type SocialLinks } from '@/lib/socialLinks';

const inputClass =
  'w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2.5 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] outline-none focus:border-[var(--a1)]';

type Notice = {
  id: string;
  title: string;
  body: string;
  severity: 'INFO' | 'WARNING' | 'SUCCESS';
  isActive: boolean;
  createdAt: string;
};

type ToolMap = Record<string, boolean>;

export default function AdminSettingsPage() {
  const { refreshSiteSettings } = useSiteSettings();
  const [siteName, setSiteName] = useState('Flowbysk');
  const [logoUrl, setLogoUrl] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [allowSignups, setAllowSignups] = useState(true);
  const [ticketSystemEnabled, setTicketSystemEnabled] = useState(true);
  const [contactPageEnabled, setContactPageEnabled] = useState(true);
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [proxyAutoRotateEnabled, setProxyAutoRotateEnabled] = useState(false);
  const [proxyAutoRotateMinutes, setProxyAutoRotateMinutes] = useState(60);
  const [lastProxyRotateAt, setLastProxyRotateAt] = useState<string | null>(null);
  const [lastProxyRotateReason, setLastProxyRotateReason] = useState<string | null>(null);
  const [rotatingProxy, setRotatingProxy] = useState(false);
  const [egressProxies, setEgressProxies] = useState<
    {
      id: string;
      url: string;
      enabled: boolean;
      ip?: string | null;
      country?: string | null;
      countryCode?: string | null;
      lastCheckedAt?: string | null;
      lastError?: string | null;
    }[]
  >([]);
  const [newProxyUrl, setNewProxyUrl] = useState('');
  const [savingProxies, setSavingProxies] = useState(false);
  const [checkingProxyId, setCheckingProxyId] = useState<string | null>(null);
  const [proxyMsg, setProxyMsg] = useState('');
  const [proxyErr, setProxyErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [accountsAccessIds, setAccountsAccessIds] = useState<string[]>([]);
  const [accountsAdmins, setAccountsAdmins] = useState<
    { id: string; email: string; name: string | null; role: string }[]
  >([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [savingAccountsAccess, setSavingAccountsAccess] = useState(false);
  const [accountsAccessMsg, setAccountsAccessMsg] = useState('');

  const [resellerMessage, setResellerMessage] = useState('');
  const [bankDetails, setBankDetails] = useState('');
  const [stripeEnabled, setStripeEnabled] = useState(true);
  const [bankEnabled, setBankEnabled] = useState(true);
  const [resellerEnabled, setResellerEnabled] = useState(true);
  const [savingGateways, setSavingGateways] = useState(false);
  const [gatewayMsg, setGatewayMsg] = useState('');

  const [notices, setNotices] = useState<Notice[]>([]);
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeBody, setNoticeBody] = useState('');
  const [noticeSeverity, setNoticeSeverity] = useState<'INFO' | 'WARNING' | 'SUCCESS'>('INFO');
  const [savingNotice, setSavingNotice] = useState(false);
  const [socialLinks, setSocialLinks] = useState<SocialLinks>({});
  const [savingSocial, setSavingSocial] = useState(false);
  const [socialMsg, setSocialMsg] = useState('');
  const [socialErr, setSocialErr] = useState('');

  const [tools, setTools] = useState<ToolMap>({});
  const [toolLabels, setToolLabels] = useState<Record<string, string>>({});
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [savingTools, setSavingTools] = useState(false);
  const [toolsMsg, setToolsMsg] = useState('');

  const load = async () => {
    try {
      const [sRes, gRes, nRes, tRes, aRes, pRes] = await Promise.all([
        fetch('/api/admin/settings'),
        fetch('/api/admin/orders/settings'),
        fetch('/api/admin/notices'),
        fetch('/api/admin/studio-controls'),
        fetch('/api/admin/accounts-access'),
        fetch('/api/admin/egress-proxies'),
      ]);
      if (sRes.ok) {
        const data = await sRes.json();
        if (data?.settings) {
          setSiteName(data.settings.siteName || 'Flowbysk');
          setLogoUrl(data.settings.logoUrl || '');
          setContactEmail(data.settings.contactEmail || '');
          setAllowSignups(data.settings.allowSignups !== false);
          setTicketSystemEnabled(data.settings.ticketSystemEnabled !== false);
          setContactPageEnabled(data.settings.contactPageEnabled !== false);
          setMaintenanceMode(data.settings.maintenanceMode === true);
          setProxyAutoRotateEnabled(data.settings.proxyAutoRotateEnabled === true);
          setProxyAutoRotateMinutes(
            Math.max(1, Number(data.settings.proxyAutoRotateMinutes) || 60)
          );
          setLastProxyRotateAt(data.settings.lastProxyRotateAt || null);
          setLastProxyRotateReason(data.settings.lastProxyRotateReason || null);
          setSocialLinks(
            data.settings.socialLinks && typeof data.settings.socialLinks === 'object'
              ? data.settings.socialLinks
              : {}
          );
        }
      }
      if (pRes.ok) {
        const data = await pRes.json();
        const list = Array.isArray(data.proxies) ? data.proxies : [];
        setEgressProxies(
          list.map((p: any) => ({
            id: String(p.id || crypto.randomUUID()),
            url: String(p.url || ''),
            enabled: p.enabled !== false,
            ip: p.ip ?? null,
            country: p.country ?? null,
            countryCode: p.countryCode ?? null,
            lastCheckedAt: p.lastCheckedAt ?? null,
            lastError: p.lastError ?? null,
          }))
        );
        if (data.lastProxyRotateAt) setLastProxyRotateAt(data.lastProxyRotateAt);
        if (typeof data.lastProxyRotateReason === 'string') {
          setLastProxyRotateReason(data.lastProxyRotateReason);
        }
      }
      if (gRes.ok) {
        const data = await gRes.json();
        const s = data.settings || {};
        setResellerMessage(s.resellerMessage || '');
        setBankDetails(s.bankDetails || '');
        setStripeEnabled(s.stripeEnabled !== false);
        setBankEnabled(s.bankEnabled !== false);
        setResellerEnabled(s.resellerEnabled !== false);
      }
      if (nRes.ok) {
        const data = await nRes.json();
        setNotices(data.notices || []);
      }
      if (tRes.ok) {
        const data = await tRes.json();
        setTools(data.tools || {});
        setToolLabels(data.toolLabels || {});
        setToolIds(data.toolIds || Object.keys(data.tools || {}));
      }
      if (aRes.ok) {
        const data = await aRes.json();
        setIsSuperAdmin(!!data.isSuperAdmin);
        setAccountsAccessIds(Array.isArray(data.adminUserIds) ? data.adminUserIds : []);
        setAccountsAdmins(Array.isArray(data.admins) ? data.admins : []);
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onSubmitSite = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteName,
          logoUrl,
          contactEmail,
          allowSignups,
          ticketSystemEnabled,
          contactPageEnabled,
          maintenanceMode,
          proxyAutoRotateEnabled,
          proxyAutoRotateMinutes,
          socialLinks,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setMessage('Site settings saved.');
      if (data?.settings?.siteName) setSiteName(data.settings.siteName);
      if (data?.settings) {
        setMaintenanceMode(data.settings.maintenanceMode === true);
        setProxyAutoRotateEnabled(data.settings.proxyAutoRotateEnabled === true);
        setProxyAutoRotateMinutes(
          Math.max(1, Number(data.settings.proxyAutoRotateMinutes) || 60)
        );
        setLastProxyRotateAt(data.settings.lastProxyRotateAt || null);
        if (data.settings.socialLinks && typeof data.settings.socialLinks === 'object') {
          setSocialLinks(data.settings.socialLinks);
        }
      }
      await refreshSiteSettings();
    } catch (err: any) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const mapProxyList = (list: any[]) =>
    list.map((p: any) => ({
      id: String(p.id || crypto.randomUUID()),
      url: String(p.url || ''),
      enabled: p.enabled !== false,
      ip: p.ip ?? null,
      country: p.country ?? null,
      countryCode: p.countryCode ?? null,
      lastCheckedAt: p.lastCheckedAt ?? null,
      lastError: p.lastError ?? null,
    }));

  const saveProxies = async (list = egressProxies) => {
    setSavingProxies(true);
    setProxyMsg('');
    setProxyErr('');
    try {
      const res = await fetch('/api/admin/egress-proxies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proxies: list }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setEgressProxies(mapProxyList(data.proxies || list));
      setProxyMsg(
        'Proxies saved. Restart BiB so Chrome uses them: pm2 restart flowbysk-bib'
      );
      setNewProxyUrl('');
    } catch (err: any) {
      setProxyErr(err.message || 'Save failed');
    } finally {
      setSavingProxies(false);
    }
  };

  const checkProxy = async (id: string) => {
    setCheckingProxyId(id);
    setProxyErr('');
    setProxyMsg('');
    try {
      // Persist current edits first so check uses the typed URL
      const saveRes = await fetch('/api/admin/egress-proxies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proxies: egressProxies }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.error || 'Save failed before check');
      if (Array.isArray(saveData.proxies)) setEgressProxies(mapProxyList(saveData.proxies));

      const res = await fetch('/api/admin/egress-proxies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Check failed');
      if (Array.isArray(data.proxies)) setEgressProxies(mapProxyList(data.proxies));
      if (data.ok) {
        setProxyMsg(`Connected via ${data.ip} (${data.country || 'Unknown'})`);
      } else {
        setProxyErr(data.error || 'Proxy check failed — not reaching the internet through this proxy');
      }
    } catch (err: any) {
      setProxyErr(err.message || 'Check failed');
    } finally {
      setCheckingProxyId(null);
    }
  };

  const onSaveSocialLinks = async (e: FormEvent) => {
    e.preventDefault();
    setSavingSocial(true);
    setSocialMsg('');
    setSocialErr('');
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socialLinks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      if (data?.settings?.socialLinks && typeof data.settings.socialLinks === 'object') {
        setSocialLinks(data.settings.socialLinks);
      }
      setSocialMsg('Social links saved — icons show on the user dashboard announcement.');
      await refreshSiteSettings();
    } catch (err: any) {
      setSocialErr(err.message || 'Save failed');
    } finally {
      setSavingSocial(false);
    }
  };

  const onSaveGateways = async (e: FormEvent) => {
    e.preventDefault();
    setSavingGateways(true);
    setGatewayMsg('');
    try {
      const res = await fetch('/api/admin/orders/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resellerMessage,
          bankDetails,
          stripeEnabled,
          bankEnabled,
          resellerEnabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setGatewayMsg('Billing gateways saved.');
    } catch (err: any) {
      setGatewayMsg(err.message || 'Save failed');
    } finally {
      setSavingGateways(false);
    }
  };

  const onSaveTools = async (e: FormEvent) => {
    e.preventDefault();
    setSavingTools(true);
    setToolsMsg('');
    try {
      const res = await fetch('/api/admin/studio-controls', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setTools(data.tools || tools);
      setToolsMsg('Studio tools saved.');
    } catch (err: any) {
      setToolsMsg(err.message || 'Save failed');
    } finally {
      setSavingTools(false);
    }
  };

  const createNotice = async (e: FormEvent) => {
    e.preventDefault();
    setSavingNotice(true);
    try {
      const res = await fetch('/api/admin/notices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: noticeTitle,
          body: noticeBody,
          severity: noticeSeverity,
          isActive: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setNoticeTitle('');
      setNoticeBody('');
      await load();
    } catch (err: any) {
      alert(err.message || 'Failed');
    } finally {
      setSavingNotice(false);
    }
  };

  const toggleNotice = async (n: Notice) => {
    await fetch(`/api/admin/notices/${n.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !n.isActive }),
    });
    await load();
  };

  const deleteNotice = async (id: string) => {
    if (!confirm('Delete this notice?')) return;
    await fetch(`/api/admin/notices/${id}`, { method: 'DELETE' });
    await load();
  };

  const Toggle = ({
    on,
    onChange,
    label,
  }: {
    on: boolean;
    onChange: (v: boolean) => void;
    label: string;
  }) => (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="flex items-center gap-2.5 rounded-full border border-[var(--line)] p-2"
      style={{ background: on ? 'var(--a1soft)' : 'transparent' }}
    >
      <span
        className="flex h-[22px] w-[38px] items-center rounded-full p-[3px]"
        style={{
          background: on ? 'var(--a1)' : 'var(--line)',
          justifyContent: on ? 'flex-end' : 'flex-start',
        }}
      >
        <span className="block h-4 w-4 rounded-full bg-[var(--card)]" />
      </span>
      <span className="pr-2 text-[13px] font-medium">{label}</span>
    </button>
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <form
        onSubmit={onSubmitSite}
        className="space-y-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6"
      >
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Settings className="h-4 w-4 text-[var(--a1)]" />
            Site branding
          </h3>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">
            Change the public website name (navbar, footer, browser tab), logo, and contact email.
          </p>
        </div>
        <label className="block text-sm">
          <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
            WEBSITE NAME
          </span>
          <input
            required
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            placeholder="e.g. Flowbysk"
            className={inputClass}
          />
          <p className="mt-1 text-[12px] text-[var(--ink3)]">
            Shown in the header, footer, login pages, and browser title.
          </p>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
            LOGO URL
          </span>
          <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
            CONTACT EMAIL
          </span>
          <input
            required
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            className={inputClass}
          />
        </label>
        <div className="flex items-center justify-between rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-3">
          <div>
            <p className="text-sm font-medium text-[var(--ink)]">Allow new signups</p>
            <p className="mt-0.5 text-[12px] text-[var(--ink3)]">
              When off, public registration is closed.
            </p>
          </div>
          <Toggle
            on={allowSignups}
            onChange={setAllowSignups}
            label={allowSignups ? 'Open' : 'Closed'}
          />
        </div>
        <div className="flex items-center justify-between rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-3">
          <div>
            <p className="text-sm font-medium text-[var(--ink)]">Support ticket system</p>
            <p className="mt-0.5 text-[12px] text-[var(--ink3)]">
              When off, the Support tab and ticket system are hidden from users.
            </p>
          </div>
          <Toggle
            on={ticketSystemEnabled}
            onChange={setTicketSystemEnabled}
            label={ticketSystemEnabled ? 'Enabled' : 'Disabled'}
          />
        </div>
        <div className="flex items-center justify-between rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-3">
          <div>
            <p className="text-sm font-medium text-[var(--ink)]">Contact page</p>
            <p className="mt-0.5 text-[12px] text-[var(--ink3)]">
              When off, /contact is hidden from the site and the form API is blocked.
            </p>
          </div>
          <Toggle
            on={contactPageEnabled}
            onChange={setContactPageEnabled}
            label={contactPageEnabled ? 'Enabled' : 'Disabled'}
          />
        </div>
        <div className="flex items-center justify-between rounded-[11px] border border-amber-500/30 bg-amber-500/5 px-3 py-3">
          <div>
            <p className="text-sm font-medium text-[var(--ink)]">Maintenance mode</p>
            <p className="mt-0.5 text-[12px] text-[var(--ink3)]">
              Shows a maintenance page site-wide after you click <b>Save site settings</b>. Bypass
              with{' '}
              <code className="rounded bg-[var(--bg2)] px-1 font-mono text-[11px]">?mod_admin</code>
              . Test in a private window (your admin session keeps a bypass cookie).
            </p>
          </div>
          <Toggle
            on={maintenanceMode}
            onChange={setMaintenanceMode}
            label={maintenanceMode ? 'ON' : 'Off'}
          />
        </div>
        {message && <p className="text-sm text-[var(--a1)]">{message}</p>}
        {error && <p className="text-sm text-rose-500">{error}</p>}
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : 'Save site settings'}
        </button>
      </form>

      <div className="space-y-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Server className="h-4 w-4 text-[var(--a1)]" />
            Egress proxies
          </h3>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">
            Add proxies, click <b>Save proxies</b>, then <b>Check</b> to verify the exit IP and
            country. First enabled proxy is used by BiB Chrome and the Python worker. After
            saving, restart BiB (`pm2 restart flowbysk-bib`). Rotate keeps the same Chrome
            profile so Google stays logged in.
          </p>
        </div>
        <div className="flex flex-col gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--bg2)] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Auto-rotate proxies</p>
              <p className="mt-0.5 text-[12px] text-[var(--ink3)]">
                Automatically switch to the next enabled proxy on a timer and relaunch BiB
                (no logout).
              </p>
            </div>
            <Toggle
              on={proxyAutoRotateEnabled}
              onChange={setProxyAutoRotateEnabled}
              label={proxyAutoRotateEnabled ? 'On' : 'Off'}
            />
          </div>
          <label className="block text-sm">
            <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
              INTERVAL (MINUTES)
            </span>
            <input
              type="number"
              min={1}
              max={1440}
              value={proxyAutoRotateMinutes}
              onChange={(e) => setProxyAutoRotateMinutes(Math.max(1, Number(e.target.value) || 60))}
              className={`${inputClass} max-w-[160px]`}
            />
          </label>
          {lastProxyRotateAt && (
            <p className="text-[12px] text-[var(--ink3)]">
              Last rotate: {new Date(lastProxyRotateAt).toLocaleString()}
              {lastProxyRotateReason ? ` · ${lastProxyRotateReason}` : ''}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary !text-[13px]"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                setProxyMsg('');
                setProxyErr('');
                try {
                  const res = await fetch('/api/admin/settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      proxyAutoRotateEnabled,
                      proxyAutoRotateMinutes,
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || 'Save failed');
                  setProxyMsg('Auto-rotate settings saved.');
                  setLastProxyRotateAt(data.settings?.lastProxyRotateAt || lastProxyRotateAt);
                } catch (err: any) {
                  setProxyErr(err.message || 'Save failed');
                } finally {
                  setSaving(false);
                }
              }}
            >
              Save auto-rotate
            </button>
            <button
              type="button"
              className="btn-primary !text-[13px]"
              disabled={rotatingProxy}
              onClick={async () => {
                setRotatingProxy(true);
                setProxyMsg('');
                setProxyErr('');
                try {
                  const res = await fetch('/api/admin/egress-proxies', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'rotate' }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || 'Rotate failed');
                  setProxyMsg(
                    `Rotated to ${data.to || 'next proxy'} · relaunched ${data.relaunched || 0} account(s)`
                  );
                  if (Array.isArray(data.proxies)) setEgressProxies(mapProxyList(data.proxies));
                  setLastProxyRotateAt(data.lastProxyRotateAt || new Date().toISOString());
                  setLastProxyRotateReason(data.lastProxyRotateReason || 'manual');
                } catch (err: any) {
                  setProxyErr(err.message || 'Rotate failed');
                } finally {
                  setRotatingProxy(false);
                }
              }}
            >
              {rotatingProxy ? 'Rotating…' : 'Rotate manually'}
            </button>
          </div>
        </div>
        {egressProxies.length === 0 && (
          <p className="text-[13px] text-[var(--ink3)]">No proxies saved yet.</p>
        )}
        <ul className="space-y-2">
          {egressProxies.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--bg2)] p-3"
            >
              <input
                value={p.url}
                onChange={(e) =>
                  setEgressProxies((prev) =>
                    prev.map((x) => (x.id === p.id ? { ...x, url: e.target.value } : x))
                  )
                }
                className={`${inputClass} font-mono text-[12px]`}
                autoComplete="off"
                spellCheck={false}
              />
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                {p.ip ? (
                  <span className="rounded-full border border-[var(--a1)]/40 px-2 py-0.5 text-[var(--a1)]">
                    IP {p.ip}
                    {p.country ? ` · ${p.country}` : ''}
                    {p.countryCode ? ` (${p.countryCode})` : ''}
                  </span>
                ) : (
                  <span className="text-[var(--ink3)]">Not checked yet</span>
                )}
                {p.lastError && (
                  <span className="text-rose-500" title={p.lastError}>
                    Check failed
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Toggle
                  on={p.enabled}
                  onChange={(on) =>
                    setEgressProxies((prev) =>
                      prev.map((x) => (x.id === p.id ? { ...x, enabled: on } : x))
                    )
                  }
                  label={p.enabled ? 'On' : 'Off'}
                />
                <button
                  type="button"
                  className="rounded-[9px] border border-[var(--line)] px-2.5 py-1.5 text-[12px]"
                  disabled={checkingProxyId === p.id}
                  onClick={() => checkProxy(p.id)}
                >
                  {checkingProxyId === p.id ? 'Checking…' : 'Check IP'}
                </button>
                <button
                  type="button"
                  className="rounded-[9px] border border-[var(--line)] px-2.5 py-1.5 text-[12px] text-rose-500"
                  onClick={() => setEgressProxies((prev) => prev.filter((x) => x.id !== p.id))}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={newProxyUrl}
            onChange={(e) => setNewProxyUrl(e.target.value)}
            placeholder="host:port:user:pass  or  http://user:pass@host:port"
            className={`${inputClass} flex-1`}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="btn-secondary whitespace-nowrap"
            onClick={() => {
              const url = newProxyUrl.trim();
              if (!url) return;
              setEgressProxies((prev) => [
                ...prev,
                { id: crypto.randomUUID(), url, enabled: true },
              ]);
              setNewProxyUrl('');
            }}
          >
            Add proxy
          </button>
        </div>
        {proxyMsg && <p className="text-sm text-[var(--a1)]">{proxyMsg}</p>}
        {proxyErr && <p className="text-sm text-rose-500">{proxyErr}</p>}
        <button
          type="button"
          disabled={savingProxies}
          className="btn-primary"
          onClick={() => saveProxies()}
        >
          {savingProxies ? 'Saving…' : 'Save proxies'}
        </button>
      </div>

      {isSuperAdmin && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSavingAccountsAccess(true);
            setAccountsAccessMsg('');
            try {
              const res = await fetch('/api/admin/accounts-access', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adminUserIds: accountsAccessIds }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || 'Save failed');
              setAccountsAccessIds(data.adminUserIds || []);
              setAccountsAccessMsg('Accounts page access saved.');
            } catch (err: any) {
              setAccountsAccessMsg(err.message || 'Save failed');
            } finally {
              setSavingAccountsAccess(false);
            }
          }}
          className="flex flex-col gap-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6"
        >
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <Server className="h-4 w-4 text-[var(--a1)]" />
              Provider Accounts access
            </h3>
            <p className="mt-1 text-[13px] text-[var(--ink3)]">
              SUPER_ADMIN always has access. Select which ADMIN users can open{' '}
              <code className="text-[12px]">/admin/accounts</code>. Everyone else is blocked.
            </p>
          </div>
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] p-3">
            {accountsAdmins.length === 0 && (
              <p className="text-sm text-[var(--ink3)]">No admin users found.</p>
            )}
            {accountsAdmins.map((u) => {
              const checked = accountsAccessIds.includes(u.id) || u.role === 'SUPER_ADMIN';
              const locked = u.role === 'SUPER_ADMIN';
              return (
                <label
                  key={u.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--card)]"
                >
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={checked}
                    onChange={(e) => {
                      if (locked) return;
                      setAccountsAccessIds((prev) =>
                        e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)
                      );
                    }}
                  />
                  <span className="min-w-0 flex-1 text-sm text-[var(--ink)]">
                    {u.name || u.email}
                    <span className="ml-2 text-[12px] text-[var(--ink3)]">{u.email}</span>
                  </span>
                  <span className="font-mono text-[10px] text-[var(--ink3)]">{u.role}</span>
                </label>
              );
            })}
          </div>
          {accountsAccessMsg && <p className="text-sm text-[var(--a1)]">{accountsAccessMsg}</p>}
          <button type="submit" disabled={savingAccountsAccess} className="btn-primary">
            <Save className="h-4 w-4" />
            {savingAccountsAccess ? 'Saving…' : 'Save accounts access'}
          </button>
        </form>
      )}

      <form
        onSubmit={onSaveTools}
        className="flex flex-col gap-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6"
      >
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Wrench className="h-4 w-4 text-[var(--a1)]" />
            Studio tools
          </h3>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">
            Turn any Studio mode or lab tool off — disabled tools are hidden for all users.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {toolIds.map((id) => (
            <Toggle
              key={id}
              on={tools[id] !== false}
              onChange={(v) => setTools((prev) => ({ ...prev, [id]: v }))}
              label={toolLabels[id] || id}
            />
          ))}
        </div>
        {toolsMsg && <p className="text-sm text-[var(--a1)]">{toolsMsg}</p>}
        <div className="flex justify-end">
          <button type="submit" disabled={savingTools} className="btn-primary">
            <Save className="h-4 w-4" />
            {savingTools ? 'Saving…' : 'Save tools'}
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6">
        <div>
          <h3 className="text-base font-semibold">User notices</h3>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">
            Active notices show at the top of every user dashboard until you turn them off or delete them.
            Social icons below appear on those announcements when you set links and save site settings.
          </p>
        </div>

        <form
          onSubmit={onSaveSocialLinks}
          className="space-y-3 rounded-[14px] border border-[var(--line)] bg-[var(--bg2)] p-4"
        >
          <p className="text-sm font-medium text-[var(--ink)]">Announcement social links</p>
          <p className="text-[12px] text-[var(--ink3)]">
            Paste full links (e.g. https://t.me/yourchannel). Leave blank to hide that icon. Click{' '}
            <b>Save social links</b> below — icons appear on the user dashboard announcement bar.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {SOCIAL_PLATFORMS.map((p) => (
              <label key={p.id} className="block text-sm">
                <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
                  {p.label.toUpperCase()}
                </span>
                <input
                  type="text"
                  inputMode="url"
                  value={socialLinks[p.id] || ''}
                  onChange={(e) =>
                    setSocialLinks((prev) => {
                      const next = { ...prev };
                      const v = e.target.value.trim();
                      if (v) next[p.id] = v;
                      else delete next[p.id];
                      return next;
                    })
                  }
                  placeholder={p.placeholder}
                  className={inputClass}
                />
              </label>
            ))}
          </div>
          {socialMsg && <p className="text-sm text-[var(--a1)]">{socialMsg}</p>}
          {socialErr && <p className="text-sm text-rose-500">{socialErr}</p>}
          <button type="submit" disabled={savingSocial} className="btn-primary !text-[13px]">
            <Save className="h-3.5 w-3.5" />
            {savingSocial ? 'Saving…' : 'Save social links'}
          </button>
        </form>

        <form onSubmit={createNotice} className="space-y-3 rounded-[14px] border border-[var(--line)] bg-[var(--bg2)] p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <input
              required
              value={noticeTitle}
              onChange={(e) => setNoticeTitle(e.target.value)}
              placeholder="Notice title"
              className={inputClass}
            />
            <select
              value={noticeSeverity}
              onChange={(e) => setNoticeSeverity(e.target.value as any)}
              className={inputClass}
            >
              <option value="INFO">Info</option>
              <option value="WARNING">Warning</option>
              <option value="SUCCESS">Success</option>
            </select>
          </div>
          <textarea
            required
            rows={3}
            value={noticeBody}
            onChange={(e) => setNoticeBody(e.target.value)}
            placeholder="Message shown to all users…"
            className={inputClass}
          />
          <button type="submit" disabled={savingNotice} className="btn-primary !text-[13px]">
            <Plus className="h-3.5 w-3.5" />
            {savingNotice ? 'Publishing…' : 'Publish notice'}
          </button>
        </form>

        <div className="flex flex-col">
          {notices.length === 0 ? (
            <p className="py-4 text-sm text-[var(--ink3)]">No notices yet.</p>
          ) : (
            notices.map((n) => (
              <div
                key={n.id}
                className="flex flex-wrap items-start justify-between gap-3 border-t border-[var(--line)] py-3 first:border-t-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{n.title}</span>
                    <span className="font-mono text-[10px] tracking-wider text-[var(--ink3)]">
                      {n.severity}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 font-mono text-[10px]"
                      style={{
                        background: n.isActive ? 'var(--a1soft)' : 'var(--bg2)',
                        color: n.isActive ? 'var(--a1)' : 'var(--ink3)',
                      }}
                    >
                      {n.isActive ? 'ACTIVE' : 'OFF'}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] text-[var(--ink2)]">{n.body}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary !px-3 !py-1.5 !text-xs" onClick={() => toggleNotice(n)}>
                    <Power className="h-3.5 w-3.5" />
                    {n.isActive ? 'Turn off' : 'Turn on'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary !px-3 !py-1.5 !text-xs !text-rose-400"
                    onClick={() => deleteNotice(n.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <form
        onSubmit={onSaveGateways}
        className="flex flex-col gap-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6"
      >
        <div>
          <h3 className="text-base font-semibold">Billing Gateways</h3>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">
            Enable or disable gateways and edit reseller / bank instructions shown to customers.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Toggle on={stripeEnabled} onChange={setStripeEnabled} label="Stripe" />
          <Toggle on={bankEnabled} onChange={setBankEnabled} label="Bank transfer" />
          <Toggle on={resellerEnabled} onChange={setResellerEnabled} label="Reseller" />
        </div>

        <label className="block text-sm">
          <span className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
            <MessageSquare className="h-3.5 w-3.5" />
            RESELLER MESSAGE
          </span>
          <textarea
            rows={3}
            value={resellerMessage}
            onChange={(e) => setResellerMessage(e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
            <Building2 className="h-3.5 w-3.5" />
            BANK TRANSFER DETAILS
          </span>
          <textarea
            rows={6}
            value={bankDetails}
            onChange={(e) => setBankDetails(e.target.value)}
            className={`${inputClass} font-mono text-[12px]`}
          />
        </label>

        {gatewayMsg && <p className="text-sm text-[var(--a1)]">{gatewayMsg}</p>}
        <div className="flex justify-end gap-2">
          <button type="submit" disabled={savingGateways} className="btn-primary">
            <Save className="h-4 w-4" />
            {savingGateways ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
