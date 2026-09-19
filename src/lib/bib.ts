const BIB_WORKER_URL = process.env.BIB_WORKER_URL || 'http://127.0.0.1:8010';

export function getBibWorkerUrl() {
  return BIB_WORKER_URL.replace(/\/$/, '');
}

/** Browser-facing BiB URL (nginx /bib proxy). Falls back to worker URL. */
export function getBibPublicUrl() {
  const pub =
    process.env.BIB_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_BIB_URL ||
    '';
  if (pub.trim()) return pub.replace(/\/$/, '');
  const app = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  if (app) return `${app}/bib`;
  return getBibWorkerUrl();
}

export async function bibFetch(path: string, init?: RequestInit) {
  const url = `${getBibWorkerUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  // flow-bib gates its mutating/control routes on x-internal-secret. Send it so
  // launch/disconnect/generate/etc. authenticate. In dev with no secret set,
  // flow-bib falls back to localhost-only auth, so omitting it is still fine.
  const internalSecret =
    process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET || '';
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(internalSecret ? { 'x-internal-secret': internalSecret } : {}),
      ...(init?.headers || {}),
    },
  });
  return res;
}

export async function bibLaunchAccount(
  accountId: string,
  opts?: { maxSlots?: number; projectIds?: string[]; profileDir?: string | null }
) {
  // Ensure sticky residential (or static) assignment before Chrome starts
  try {
    const {
      allocateDataImpulseForAccount,
      isDataImpulseReady,
      readDataImpulseConfig,
    } = await import('@/lib/dataimpulse');
    const { ensureUniqueProxyForAccount } = await import('@/lib/egressProxy');
    const cfg = readDataImpulseConfig();
    if (isDataImpulseReady(cfg) && cfg.autoAssignOnLaunch) {
      allocateDataImpulseForAccount(accountId);
    } else {
      ensureUniqueProxyForAccount(accountId);
    }
  } catch (e) {
    console.warn('[bibLaunch] proxy allocate:', e);
  }

  const res = await bibFetch(`/accounts/${encodeURIComponent(accountId)}/launch`, {
    method: 'POST',
    body: JSON.stringify({
      maxSlots: opts?.maxSlots,
      projectIds: opts?.projectIds,
      profileDir: opts?.profileDir || undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `BiB launch failed (${res.status})`);
  return data;
}

/**
 * Ensure the account Chrome is running. Auto-launches after BiB restarts.
 * When BiB reports READY, sync Prisma so Admin stops showing CREDENTIALS_EXPIRED
 * from stale labs.google cookie probes.
 */
export async function ensureBibAccountReady(account: {
  id: string;
  maxParallelLimit?: number | null;
  flowProjectIds?: unknown;
  profileDir?: string | null;
}) {
  if (!account?.id) throw new Error('account id required');
  let live: any = null;
  try {
    live = await bibAccountStatus(account.id);
    if (live?.running || live?.status === 'READY' || live?.status === 'NEEDS_LOGIN' || live?.status === 'ERROR') {
      // keep going — may still need launch if not READY
    } else {
      live = null;
    }
  } catch {
    live = null;
  }

  if (
    !live ||
    (live.status !== 'READY' &&
      live.status !== 'NEEDS_LOGIN' &&
      live.status !== 'ERROR' &&
      !live.running)
  ) {
    live = await bibLaunchAccount(account.id, {
      maxSlots: account.maxParallelLimit || 5,
      projectIds: Array.isArray(account.flowProjectIds)
        ? (account.flowProjectIds as string[])
        : [],
      profileDir: account.profileDir,
    });
  }

  // Sync DB from live BiB — cookie-based "expired" is often wrong for BiB accounts
  try {
    const { prisma } = await import('@/lib/prisma');
    const { BrowserStatus, ProviderStatus } = await import('@prisma/client');
    const egressBad = !!(
      live?.egress?.error ||
      /Egress proxy|tunnel|no exit/i.test(String(live?.lastError || ''))
    );
    const realLoginUrl = /accounts\.google\.com|\/signin|oauth|ServiceLogin|challenge/i.test(
      String(live?.url || '')
    );
    if (live?.status === 'READY' || live?.running) {
      await prisma.providerAccount.update({
        where: { id: account.id },
        data: {
          browserStatus: BrowserStatus.READY,
          status: ProviderStatus.HEALTHY,
          bibLastSeenAt: new Date(),
          bibLastError: egressBad ? live?.egress?.error || live?.lastError || null : null,
          ...(Array.isArray(live.projectIds) && live.projectIds.length
            ? { flowProjectIds: live.projectIds }
            : {}),
          ...(live.email ? { accountEmail: live.email } : {}),
        },
      });
    } else if (live?.status === 'ERROR' || (egressBad && live?.status !== 'NEEDS_LOGIN')) {
      // Dead proxy / ERROR — do not mark NEEDS_LOGIN
      await prisma.providerAccount.update({
        where: { id: account.id },
        data: {
          browserStatus: BrowserStatus.READY,
          bibLastSeenAt: new Date(),
          bibLastError: live?.lastError || live?.egress?.error || 'Egress/proxy error',
        },
      });
    } else if (live?.status === 'NEEDS_LOGIN' && realLoginUrl) {
      await prisma.providerAccount.update({
        where: { id: account.id },
        data: {
          browserStatus: BrowserStatus.NEEDS_LOGIN,
          bibLastSeenAt: new Date(),
          bibLastError: live.lastError || 'BiB needs Google login',
        },
      });
    } else if (live?.status === 'NEEDS_LOGIN' && !realLoginUrl) {
      // Marketing landing misclassified as logout — keep READY if browser running
      await prisma.providerAccount.update({
        where: { id: account.id },
        data: {
          browserStatus: live?.running ? BrowserStatus.READY : BrowserStatus.NEEDS_LOGIN,
          bibLastSeenAt: new Date(),
          bibLastError: live.lastError || (egressBad ? 'Proxy/session issue' : null),
        },
      });
    }
  } catch (e) {
    console.warn('[bib] prisma sync after ensure failed:', (e as Error)?.message || e);
  }

  return live;
}

export async function bibDisconnectAccount(accountId: string, clearProfile = false) {
  const res = await bibFetch(`/accounts/${encodeURIComponent(accountId)}/disconnect`, {
    method: 'POST',
    body: JSON.stringify({ clearProfile }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `BiB disconnect failed (${res.status})`);
  return data;
}

export async function bibAccountStatus(accountId: string) {
  const res = await bibFetch(`/accounts/${encodeURIComponent(accountId)}/status`);
  return res.json();
}

/** Navigate the account's BiB Chrome to a URL (e.g. a Flow project page). */
export async function bibNavigate(accountId: string, url: string) {
  const res = await bibFetch(`/accounts/${encodeURIComponent(accountId)}/navigate`, {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `BiB navigate failed (${res.status})`);
  return data;
}

export async function bibEnsureLabs(accountId: string) {
  const res = await bibFetch(`/accounts/${encodeURIComponent(accountId)}/ensure-labs`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `ensure-labs failed (${res.status})`);
  return data as {
    success?: boolean;
    hasAccessToken?: boolean;
    warm?: { ok?: boolean; reason?: string };
  };
}

export async function bibEnsureProjects(accountId: string, maxSlots: number) {
  const res = await bibFetch(`/accounts/${encodeURIComponent(accountId)}/ensure-projects`, {
    method: 'POST',
    body: JSON.stringify({ maxSlots }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `ensure-projects failed (${res.status})`);
  return data;
}

export async function bibScrapeProjects(accountId: string) {
  const res = await bibFetch(`/accounts/${encodeURIComponent(accountId)}/scrape-projects`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `scrape-projects failed (${res.status})`);
  return data;
}

function unusualHintFromBibData(data: Record<string, unknown>): string {
  const blob = JSON.stringify(data?.stages ?? data ?? {});
  const throttle = blob.match(
    /PUBLIC_ERROR_USER_REQUESTS_THROTTLED|USER_REQUESTS_THROTTLED|REQUESTS_THROTTLED/i
  );
  if (throttle) return 'PUBLIC_ERROR_USER_REQUESTS_THROTTLED';
  const m = blob.match(/PUBLIC_ERROR_[A-Z0-9_]*UNUSUAL_ACTIVITY[A-Z0-9_]*/i);
  if (m) return m[0];
  if (/UNUSUAL_ACTIVITY|TOO_MUCH_TRAFFIC|RECAPTCHA/i.test(blob)) return 'UNUSUAL_ACTIVITY';
  return '';
}

export async function bibGenerateImage(payload: {
  accountId: string;
  prompt: string;
  aspectRatio?: string;
  model?: string;
  projectId?: string;
  /** Flow media UUIDs for I2I / ingredients remix (BiB page mint — no CDP) */
  imageId?: string;
  imageIds?: string[];
  characters?: Array<Record<string, unknown>>;
  /** Bind remix output onto an existing Flow character entity (C4BZMd id) */
  destinationCharacterId?: string;
}) {
  const res = await bibFetch('/generate', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      destinationCharacterId: payload.destinationCharacterId,
      destination_character_id: payload.destinationCharacterId,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const base = data.error || data.raw || `BiB generate failed (${res.status})`;
    const hint = unusualHintFromBibData(data);
    throw new Error(
      hint && !/UNUSUAL_ACTIVITY|TOO_MUCH_TRAFFIC|USER_REQUESTS_THROTTLED|THROTTLED/i.test(String(base))
        ? `${base} (${hint})`
        : String(base)
    );
  }
  return data as {
    success: boolean;
    status?: string;
    imageUrl?: string | null;
    url?: string | null;
    mediaId?: string | null;
    projectId?: string;
    seed?: number;
    assets?: { url?: string; id?: string; status?: string }[];
  };
}

export async function bibGenerateVideo(payload: Record<string, unknown>) {
  const res = await bibFetch('/generate-video', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const stage = data.stage ? ` [${data.stage}]` : '';
    const base =
      data.error || data.raw || `BiB video failed (${res.status})${stage}`;
    const hint = unusualHintFromBibData(data);
    throw new Error(
      hint && !/UNUSUAL_ACTIVITY|TOO_MUCH_TRAFFIC|USER_REQUESTS_THROTTLED|THROTTLED/i.test(String(base))
        ? `${base} (${hint})`
        : String(base)
    );
  }
  return data as {
    success: boolean;
    status?: string;
    videoUrl?: string | null;
    url?: string | null;
    mediaId?: string;
    projectId?: string;
    accountId?: string;
    error?: string;
  };
}

export async function bibVideoStatus(payload: {
  accountId: string;
  mediaId: string;
  projectId?: string;
}) {
  const run = async () => {
    const res = await bibFetch('/video-status', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err: any = new Error(data.error || `BiB video-status failed (${res.status})`);
      err.status = res.status;
      err.retryable = data.retryable === true || res.status === 409;
      throw err;
    }
    return data as {
      success: boolean;
      status: string;
      videoUrl?: string | null;
      imageUrl?: string | null;
      url?: string | null;
      mediaId?: string;
      projectId?: string;
      error?: string;
    };
  };

  try {
    return await run();
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (
      e?.retryable ||
      /browser not launched|Target closed|not attached|ECONNREFUSED|fetch failed/i.test(msg)
    ) {
      try {
        await ensureBibAccountReady({ id: payload.accountId });
        return await run();
      } catch {
        /* still down — caller keeps job PROCESSING */
      }
    }
    throw e;
  }
}

export async function bibExportCookies(accountId: string) {
  const res = await bibFetch(`/accounts/${encodeURIComponent(accountId)}/export-cookies`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `BiB export-cookies failed (${res.status})`);
  return data as {
    cookie?: string;
    authenticated?: boolean;
    origin?: string;
    at?: string;
    bl?: string;
    sid?: string;
    cookieNames?: string[];
    hasLabsSession?: boolean;
  };
}

/** Create a Flow character entity via live BiB WIZ session (C4BZMd). */
export async function bibCreateCharacter(payload: {
  accountId: string;
  name: string;
  projectId?: string;
  imageMediaId?: string | null;
}) {
  const res = await bibFetch('/create-character', {
    method: 'POST',
    body: JSON.stringify({
      accountId: payload.accountId,
      name: payload.name,
      displayName: payload.name,
      projectId: payload.projectId,
      imageMediaId: payload.imageMediaId || undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `BiB create-character failed (${res.status})`);
  }
  return data as {
    success: boolean;
    flowEntityId: string;
    characterId?: string;
    entity_id?: string;
    displayName?: string;
    imageMediaId?: string | null;
    portraitBindNeeded?: boolean;
    createdWithMedia?: boolean;
    projectId?: string;
    accountId?: string;
  };
}

/**
 * Upload an image to a Flow project via live BiB WIZ session (maseQ batchexecute — no CDP).
 * Accepts either a base64-encoded image or a remote image URL.
 */
export async function bibUploadImage(payload: {
  accountId: string;
  projectId?: string;
  imageBase64?: string;
  imageUrl?: string;
  mimeType?: string;
  filename?: string;
}) {
  const res = await bibFetch(`/accounts/${encodeURIComponent(payload.accountId)}/upload-image`, {
    method: 'POST',
    body: JSON.stringify({
      projectId: payload.projectId,
      imageBase64: payload.imageBase64,
      imageUrl: payload.imageUrl,
      mimeType: payload.mimeType || 'image/jpeg',
      filename: payload.filename || 'upload.jpg',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `BiB upload-image failed (${res.status})`);
  }
  return data as {
    success: boolean;
    mediaId: string;
    imageUrl?: string;
    projectId?: string;
    ms?: number;
  };
}

export async function bibBootstrap(accounts: { id: string; maxSlots?: number; projectIds?: string[]; profileDir?: string | null }[]) {
  const res = await bibFetch('/bootstrap', {
    method: 'POST',
    body: JSON.stringify({ accounts }),
  });
  return res.json();
}

export function bibViewerUrl(accountId: string, opts?: { url?: string }) {
  const base = `${getBibPublicUrl()}/account.html?accountId=${encodeURIComponent(accountId)}`;
  if (opts?.url) return `${base}&url=${encodeURIComponent(opts.url)}`;
  return base;
}

export { BIB_WORKER_URL };
