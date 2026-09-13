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
  const [egressProxyUrl, setEgressProxyUrl] = useState('');
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

  const [tools, setTools] = useState<ToolMap>({});
  const [toolLabels, setToolLabels] = useState<Record<string, string>>({});
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [savingTools, setSavingTools] = useState(false);
  const [toolsMsg, setToolsMsg] = useState('');

  const load = async () => {
    try {
      const [sRes, gRes, nRes, tRes, aRes] = await Promise.all([
        fetch('/api/admin/settings'),
        fetch('/api/admin/orders/settings'),
        fetch('/api/admin/notices'),
        fetch('/api/admin/studio-controls'),
        fetch('/api/admin/accounts-access'),
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
          setEgressProxyUrl(data.settings.egressProxyUrl || '');
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
          egressProxyUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setMessage('Site settings saved.');
      if (data?.settings?.siteName) setSiteName(data.settings.siteName);
      if (data?.settings?.egressProxyUrl !== undefined) {
        setEgressProxyUrl(data.settings.egressProxyUrl || '');
      }
      await refreshSiteSettings();
    } catch (err: any) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
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
        <label className="block text-sm">
          <span className="mb-1.5 block font-mono text-[10px] tracking-[0.1em] text-[var(--ink3)]">
            EGRESS PROXY
          </span>
          <input
            value={egressProxyUrl}
            onChange={(e) => setEgressProxyUrl(e.target.value)}
            placeholder="http://user:pass@host:port"
            className={inputClass}
            autoComplete="off"
          />
          <p className="mt-1 text-[12px] text-[var(--ink3)]">
            Optional HTTP(S) proxy for BiB Chrome and the Python worker when calling Google.
            Leave empty for direct. After saving, restart BiB browsers so Chrome picks it up
            (`pm2 restart flowbysk-bib`).
          </p>
        </label>
        {message && <p className="text-sm text-[var(--a1)]">{message}</p>}
        {error && <p className="text-sm text-rose-500">{error}</p>}
        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : 'Save site settings'}
        </button>
      </form>

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
          </p>
        </div>

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
