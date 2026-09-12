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
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  return res;
}

export async function bibLaunchAccount(
  accountId: string,
  opts?: { maxSlots?: number; projectIds?: string[]; profileDir?: string | null }
) {
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
    if (live?.running || live?.status === 'READY' || live?.status === 'NEEDS_LOGIN') {
      // keep going — may still need launch if not READY
    } else {
      live = null;
    }
  } catch {
    live = null;
  }

  if (!live || (live.status !== 'READY' && live.status !== 'NEEDS_LOGIN' && !live.running)) {
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
    if (live?.status === 'READY' || live?.running) {
      await prisma.providerAccount.update({
        where: { id: account.id },
        data: {
          browserStatus: BrowserStatus.READY,
          status: ProviderStatus.HEALTHY,
          bibLastSeenAt: new Date(),
          bibLastError: null,
          ...(Array.isArray(live.projectIds) && live.projectIds.length
            ? { flowProjectIds: live.projectIds }
            : {}),
          ...(live.email ? { accountEmail: live.email } : {}),
        },
      });
    } else if (live?.status === 'NEEDS_LOGIN') {
      await prisma.providerAccount.update({
        where: { id: account.id },
        data: {
          browserStatus: BrowserStatus.NEEDS_LOGIN,
          bibLastSeenAt: new Date(),
          bibLastError: live.lastError || 'BiB needs Google login',
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
    throw new Error(data.error || data.raw || `BiB generate failed (${res.status})`);
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
    throw new Error(
      data.error || data.raw || `BiB video failed (${res.status})${stage}`
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
  const res = await bibFetch('/video-status', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `BiB video-status failed (${res.status})`);
  return data as {
    success: boolean;
    status: string;
    videoUrl?: string | null;
    imageUrl?: string | null;
    url?: string | null;
    mediaId?: string;
    projectId?: string;
  };
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
    projectId?: string;
    accountId?: string;
  };
}

export async function bibBootstrap(accounts: { id: string; maxSlots?: number; projectIds?: string[]; profileDir?: string | null }[]) {
  const res = await bibFetch('/bootstrap', {
    method: 'POST',
    body: JSON.stringify({ accounts }),
  });
  return res.json();
}

export function bibViewerUrl(accountId: string) {
  return `${getBibPublicUrl()}/account.html?accountId=${encodeURIComponent(accountId)}`;
}

export { BIB_WORKER_URL };
