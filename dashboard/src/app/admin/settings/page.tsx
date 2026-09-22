'use client';

import { FormEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Upload } from 'lucide-react';
import { flowFetch } from '@/lib/flowApi';
import { SOCIAL_PLATFORMS, type SocialLinks } from '@/lib/socialLinks';

type Notice = {
  id: string;
  title: string;
  body: string;
  severity: 'INFO' | 'WARNING' | 'SUCCESS';
  isActive: boolean;
};

type SiteForm = {
  siteName: string;
  logoUrl: string;
  contactEmail: string;
  allowSignups: boolean;
  ticketSystemEnabled: boolean;
  contactPageEnabled: boolean;
  maintenanceMode: boolean;
};

type DownloadPackage = {
  originalName: string;
  size: number;
  updatedAt: string | null;
  contentType?: string | null;
  externalUrl?: string | null;
  source?: 'url' | 'file';
} | null;

type DownloadsState = {
  windows: DownloadPackage;
  android: DownloadPackage;
};

const inputClass =
  'w-full rounded-[11px] border border-[var(--line)] bg-[var(--bg2)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--a1)]';

const emptySite: SiteForm = {
  siteName: '',
  logoUrl: '',
  contactEmail: '',
  allowSignups: true,
  ticketSystemEnabled: true,
  contactPageEnabled: true,
  maintenanceMode: false,
};

function formatBytes(n: number) {
  if (!n || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUpdated(iso: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function Toggle({
  on,
  onLabel,
  offLabel,
  onChange,
}: {
  on: boolean;
  onLabel: string;
  offLabel: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-2 py-1 text-xs"
    >
      <span
        className="relative h-5 w-9 rounded-full"
        style={{ background: on ? 'var(--a1)' : 'var(--bg2)' }}
      >
        <span
          className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition"
          style={{ left: on ? '18px' : '2px' }}
        />
      </span>
      <span className="min-w-[52px] text-left font-medium">{on ? onLabel : offLabel}</span>
    </button>
  );
}

export default function AdminSettingsPage() {
  const [site, setSite] = useState<SiteForm>(emptySite);
  const [social, setSocial] = useState<SocialLinks>({});
  const [notices, setNotices] = useState<Notice[]>([]);
  const [downloads, setDownloads] = useState<DownloadsState>({ windows: null, android: null });
  const [downloadUrls, setDownloadUrls] = useState<{ windows: string; android: string }>({ windows: '', android: '' });
  const [uploading, setUploading] = useState<'windows' | 'android' | null>(null);
  const [savingUrl, setSavingUrl] = useState<'windows' | 'android' | null>(null);
  const windowsInputRef = useRef<HTMLInputElement>(null);
  const androidInputRef = useRef<HTMLInputElement>(null);
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeBody, setNoticeBody] = useState('');
  const [noticeSeverity, setNoticeSeverity] = useState<Notice['severity']>('INFO');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [settingsRes, noticesRes, downloadsRes] = await Promise.all([
      flowFetch('/api/admin/settings'),
      flowFetch('/api/admin/notices'),
      flowFetch('/api/admin/downloads'),
    ]);
    const settingsData = await settingsRes.json();
    const noticesData = await noticesRes.json();
    const downloadsData = await downloadsRes.json();
    if (!settingsRes.ok) throw new Error(settingsData.error || 'Could not load settings');
    const row = settingsData.settings || {};
    setSite({
      siteName: row.siteName || row.appName || '',
      logoUrl: row.logoUrl || '',
      contactEmail: row.contactEmail || '',
      allowSignups: row.allowSignups !== false,
      ticketSystemEnabled: row.ticketSystemEnabled !== false,
      contactPageEnabled: row.contactPageEnabled !== false,
      maintenanceMode: row.maintenanceMode === true,
    });
    setSocial(row.socialLinks || {});
    if (noticesRes.ok) setNotices(noticesData.notices || []);
    if (downloadsRes.ok) {
      setDownloads({
        windows: downloadsData.downloads?.windows || null,
        android: downloadsData.downloads?.android || null,
      });
      setDownloadUrls({
        windows: downloadsData.downloads?.windows?.externalUrl || '',
        android: downloadsData.downloads?.android?.externalUrl || '',
      });
    }
  };

  useEffect(() => {
    load().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load settings'));
  }, []);

  const saveSite = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const res = await flowFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(site),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save settings');
      if (newPassword) {
        const passRes = await flowFetch('/api/admin/password', {
          method: 'PUT',
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        const passData = await passRes.json();
        if (!passRes.ok) throw new Error(passData.error || 'Could not change password');
        setCurrentPassword('');
        setNewPassword('');
      }
      setMessage('Site settings saved');
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveSocial = async () => {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const res = await flowFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ socialLinks: social }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save social links');
      setMessage('Social links saved');
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const uploadPackage = async (platform: 'windows' | 'android', file: File | null | undefined) => {
    if (!file) return;
    setUploading(platform);
    setMessage('');
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await flowFetch(`/api/admin/downloads/${platform}`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setDownloads({
        windows: data.downloads?.windows || null,
        android: data.downloads?.android || null,
      });
      setDownloadUrls({
        windows: data.downloads?.windows?.externalUrl || '',
        android: data.downloads?.android?.externalUrl || '',
      });
      setMessage(`${platform === 'windows' ? 'Windows' : 'Android'} package uploaded`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  const removePackage = async (platform: 'windows' | 'android') => {
    if (!confirm(`Remove the ${platform} package? Users will no longer be able to download it.`)) return;
    setError('');
    setMessage('');
    const res = await flowFetch(`/api/admin/downloads/${platform}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Could not remove package');
      return;
    }
    setDownloads({
      windows: data.downloads?.windows || null,
      android: data.downloads?.android || null,
    });
    setDownloadUrls((prev) => ({ ...prev, [platform]: '' }));
    setMessage(`${platform === 'windows' ? 'Windows' : 'Android'} package removed`);
  };

  const savePackageUrl = async (platform: 'windows' | 'android') => {
    setSavingUrl(platform);
    setError('');
    setMessage('');
    try {
      const res = await flowFetch(`/api/admin/downloads/${platform}/url`, {
        method: 'PUT',
        body: JSON.stringify({ url: downloadUrls[platform].trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save URL');
      setDownloads({
        windows: data.downloads?.windows || null,
        android: data.downloads?.android || null,
      });
      setDownloadUrls({
        windows: data.downloads?.windows?.externalUrl || '',
        android: data.downloads?.android?.externalUrl || '',
      });
      setMessage(
        downloadUrls[platform].trim()
          ? `${platform === 'windows' ? 'Windows' : 'Android'} download URL saved`
          : `${platform === 'windows' ? 'Windows' : 'Android'} download URL cleared`
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save URL');
    } finally {
      setSavingUrl(null);
    }
  };

  const publishNotice = async () => {
    setError('');
    setMessage('');
    const res = await flowFetch('/api/admin/notices', {
      method: 'POST',
      body: JSON.stringify({ title: noticeTitle, body: noticeBody, severity: noticeSeverity, isActive: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Could not publish notice');
      return;
    }
    setNoticeTitle('');
    setNoticeBody('');
    setNoticeSeverity('INFO');
    setMessage('Notice published');
    await load();
  };

  const setNoticeActive = async (notice: Notice, isActive: boolean) => {
    const res = await flowFetch(`/api/admin/notices/${notice.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
    if (res.ok) await load();
  };

  const deleteNotice = async (notice: Notice) => {
    if (!confirm(`Delete notice “${notice.title}”?`)) return;
    const res = await flowFetch(`/api/admin/notices/${notice.id}`, { method: 'DELETE' });
    if (res.ok) await load();
  };

  const PackageCard = ({
    platform,
    label,
    accept,
    hint,
    inputRef,
  }: {
    platform: 'windows' | 'android';
    label: string;
    accept: string;
    hint: string;
    inputRef: RefObject<HTMLInputElement | null>;
  }) => {
    const pkg = downloads[platform];
    return (
      <div className="rounded-2xl border border-[var(--line)] px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{label}</div>
            <p className="mt-1 text-xs text-[var(--ink3)]">{hint}</p>
            {pkg ? (
              <dl className="mt-3 grid gap-1 text-sm text-[var(--ink2)]">
                <div>
                  <span className="text-[var(--ink3)]">Source: </span>
                  {pkg.source === 'url' ? 'CDN / Drive URL' : 'Uploaded file'}
                </div>
                <div>
                  <span className="text-[var(--ink3)]">Label: </span>
                  {pkg.originalName}
                </div>
                {pkg.source !== 'url' && (
                  <div>
                    <span className="text-[var(--ink3)]">Size: </span>
                    {formatBytes(pkg.size)}
                  </div>
                )}
                {pkg.externalUrl && (
                  <div className="break-all">
                    <span className="text-[var(--ink3)]">URL: </span>
                    {pkg.externalUrl}
                  </div>
                )}
                <div>
                  <span className="text-[var(--ink3)]">Updated: </span>
                  {formatUpdated(pkg.updatedAt)}
                </div>
              </dl>
            ) : (
              <p className="mt-3 text-sm text-[var(--ink3)]">No file or URL set yet.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void uploadPackage(platform, file);
              }}
            />
            <button
              type="button"
              className="btn-primary !px-3 !py-1.5 !text-xs"
              disabled={uploading === platform || savingUrl === platform}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading === platform ? 'Uploading…' : pkg?.source === 'file' ? 'Replace file' : 'Upload file'}
            </button>
            {pkg && (
              <button
                type="button"
                className="btn-secondary !px-3 !py-1.5 !text-xs"
                disabled={uploading === platform || savingUrl === platform}
                onClick={() => void removePackage(platform)}
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <div className="mt-4 grid gap-2 border-t border-[var(--line)] pt-4">
          <label className="text-xs text-[var(--ink3)]">
            CDN / Google Drive URL (optional — used instead of upload)
            <input
              className={`${inputClass} mt-1`}
              placeholder="https://cdn.example.com/Flow-Browser.exe"
              value={downloadUrls[platform]}
              onChange={(e) => setDownloadUrls((prev) => ({ ...prev, [platform]: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="btn-secondary self-start !px-3 !py-1.5 !text-xs"
            disabled={uploading === platform || savingUrl === platform}
            onClick={() => void savePackageUrl(platform)}
          >
            {savingUrl === platform ? 'Saving…' : 'Save URL'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {message && <p className="text-sm text-[var(--a1)]">{message}</p>}
      {error && <p className="text-sm text-rose-400">{error}</p>}

      <form onSubmit={saveSite} className="flex flex-col gap-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6">
        <div>
          <h3 className="text-base font-semibold">Site branding</h3>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">
            Change the public website name (navbar, footer, browser tab), logo, and contact email.
          </p>
        </div>
        <label className="text-xs text-[var(--ink3)]">
          WEBSITE NAME
          <input className={`${inputClass} mt-1`} value={site.siteName} onChange={(e) => setSite({ ...site, siteName: e.target.value })} />
          <span className="mt-1 block">Shown in the header, footer, login pages, and browser title.</span>
        </label>
        <label className="text-xs text-[var(--ink3)]">
          LOGO URL
          <input className={`${inputClass} mt-1`} value={site.logoUrl} onChange={(e) => setSite({ ...site, logoUrl: e.target.value })} placeholder="https://example.com/logo.png" />
        </label>
        <label className="text-xs text-[var(--ink3)]">
          CONTACT EMAIL
          <input className={`${inputClass} mt-1`} value={site.contactEmail} onChange={(e) => setSite({ ...site, contactEmail: e.target.value })} />
        </label>

        <div className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--line)] px-4 py-3">
          <div>
            <div className="text-sm font-medium">Allow new signups</div>
            <p className="text-xs text-[var(--ink3)]">When off, public registration is closed.</p>
          </div>
          <Toggle on={site.allowSignups} onLabel="Open" offLabel="Closed" onChange={(allowSignups) => setSite({ ...site, allowSignups })} />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--line)] px-4 py-3">
          <div>
            <div className="text-sm font-medium">Support ticket system</div>
            <p className="text-xs text-[var(--ink3)]">When off, the Support tab and ticket system are hidden from users.</p>
          </div>
          <Toggle on={site.ticketSystemEnabled} onLabel="Enabled" offLabel="Disabled" onChange={(ticketSystemEnabled) => setSite({ ...site, ticketSystemEnabled })} />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--line)] px-4 py-3">
          <div>
            <div className="text-sm font-medium">Contact page</div>
            <p className="text-xs text-[var(--ink3)]">When off, /contact is hidden from the site and the form API is blocked.</p>
          </div>
          <Toggle on={site.contactPageEnabled} onLabel="Enabled" offLabel="Disabled" onChange={(contactPageEnabled) => setSite({ ...site, contactPageEnabled })} />
        </div>
        <div
          className="flex items-center justify-between gap-4 rounded-2xl border px-4 py-3"
          style={{ borderColor: site.maintenanceMode ? 'var(--a1)' : 'var(--line)' }}
        >
          <div>
            <div className="text-sm font-medium">Maintenance mode</div>
            <p className="text-xs text-[var(--ink3)]">
              Shows a maintenance page site-wide after you click Save site settings.
            </p>
          </div>
          <Toggle on={site.maintenanceMode} onLabel="ON" offLabel="Off" onChange={(maintenanceMode) => setSite({ ...site, maintenanceMode })} />
        </div>

        <div>
          <h3 className="text-base font-semibold">Change password</h3>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">
            Enter your current password and a new one, then save. Leave both blank to keep the current password.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-[var(--ink3)]">
            Current admin password
            <input type="password" className={`${inputClass} mt-1`} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--ink3)]">
            New admin password
            <input type="password" className={`${inputClass} mt-1`} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </label>
        </div>
        <button type="submit" disabled={saving} className="btn-primary self-start">
          {saving ? 'Saving…' : 'Save site settings'}
        </button>
      </form>

      <section className="flex flex-col gap-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6">
        <div>
          <h3 className="text-base font-semibold">Download file management</h3>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">
            Upload a Windows/Android installer, or paste a CDN / Google Drive URL. Users get that package when they click Download on their overview.
            Uploaded files are stored outside source code so a code push will not wipe them. Saving a URL replaces any uploaded file for that platform.
          </p>
        </div>
        <PackageCard
          platform="windows"
          label="Windows package"
          accept=".exe,.zip,.msi,application/x-msdownload,application/zip"
          hint="Accepts .exe, .zip, or .msi"
          inputRef={windowsInputRef}
        />
        <PackageCard
          platform="android"
          label="Android package"
          accept=".apk,.aab,application/vnd.android.package-archive"
          hint="Accepts .apk or .aab"
          inputRef={androidInputRef}
        />
      </section>

      <section className="flex flex-col gap-4 rounded-[18px] border border-[var(--line)] bg-[var(--card)] p-6">
        <div>
          <h3 className="text-base font-semibold">User notices</h3>
          <p className="mt-1 text-[13px] text-[var(--ink3)]">
            Active notices show at the top of every user dashboard until you turn them off or delete them. Social icons appear on those announcements when you set links and save site settings.
          </p>
        </div>
        <div>
          <h4 className="text-sm font-medium">Announcement social links</h4>
          <p className="mt-1 text-xs text-[var(--ink3)]">
            Paste full links. Leave blank to hide that icon. Click Save social links — icons appear on the user dashboard announcement bar.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {SOCIAL_PLATFORMS.map((platform) => (
            <label key={platform.id} className="text-xs text-[var(--ink3)]">
              {platform.label.toUpperCase()}
              <input
                className={`${inputClass} mt-1`}
                placeholder={platform.placeholder}
                value={social[platform.id] || ''}
                onChange={(e) => setSocial({ ...social, [platform.id]: e.target.value } as SocialLinks)}
              />
            </label>
          ))}
        </div>
        <button type="button" disabled={saving} onClick={saveSocial} className="btn-primary self-start">
          Save social links
        </button>

        <div className="grid gap-3 border-t border-[var(--line)] pt-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <input className={inputClass} placeholder="Notice title" value={noticeTitle} onChange={(e) => setNoticeTitle(e.target.value)} />
            <select className={inputClass} value={noticeSeverity} onChange={(e) => setNoticeSeverity(e.target.value as Notice['severity'])}>
              <option value="INFO">Info</option>
              <option value="WARNING">Warning</option>
              <option value="SUCCESS">Success</option>
            </select>
          </div>
          <textarea
            className={inputClass}
            rows={3}
            placeholder="Message shown to all users..."
            value={noticeBody}
            onChange={(e) => setNoticeBody(e.target.value)}
          />
          <button type="button" onClick={publishNotice} className="btn-primary self-start">
            <Plus className="h-4 w-4" />
            Publish notice
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {notices.length === 0 && <p className="text-sm text-[var(--ink3)]">No notices yet.</p>}
          {notices.map((notice) => (
            <article key={notice.id} className="rounded-2xl border border-[var(--line)] px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{notice.title}</span>
                    <span className="rounded-full bg-[var(--bg2)] px-2 py-0.5 font-mono text-[10px] text-[var(--ink3)]">{notice.severity}</span>
                    <span className="rounded-full px-2 py-0.5 font-mono text-[10px]" style={{ background: notice.isActive ? 'var(--a1soft)' : 'var(--bg2)', color: notice.isActive ? 'var(--a1)' : 'var(--ink3)' }}>
                      {notice.isActive ? 'ACTIVE' : 'OFF'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--ink2)]">{notice.body}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" className="btn-secondary !px-3 !py-1.5 !text-xs" onClick={() => setNoticeActive(notice, !notice.isActive)}>
                    {notice.isActive ? 'Turn off' : 'Turn on'}
                  </button>
                  <button type="button" className="text-[var(--ink3)] hover:text-rose-400" onClick={() => deleteNotice(notice)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
