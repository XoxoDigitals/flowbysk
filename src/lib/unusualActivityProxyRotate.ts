import { prisma } from './prisma';
import { BrowserStatus } from '@prisma/client';
import {
  maskProxyUrl,
  rotateActiveEgressProxy,
  rotateProxyForAccount,
  reassignUniqueProxies,
  readEgressProxyMirror,
  activeEgressProxyUrl,
  getProxyUrlForAccount,
} from './egressProxy';
import {
  bibDisconnectAccount,
  bibFetch,
  bibLaunchAccount,
  bibAccountStatus,
} from './bib';
import { writeSiteRuntimePatch, readSiteRuntime } from './siteRuntime';

let rotating = false;

const UNUSUAL_RE =
  /UNUSUAL_ACTIVITY|TOO_MUCH_TRAFFIC|RECAPTCHA|unusual\s*activity/i;

export function isUnusualActivityError(raw: unknown): boolean {
  return UNUSUAL_RE.test(String(raw ?? ''));
}

export function resetUnusualActivityStreak(): void {
  try {
    writeSiteRuntimePatch({ unusualActivityStreak: 0 });
  } catch {
    /* ignore */
  }
}

export function getUnusualActivityStreak(): number {
  return Math.max(0, readSiteRuntime().unusualActivityStreak || 0);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function relaunchAccount(acc: {
  id: string;
  maxParallelLimit?: number | null;
  flowProjectIds?: unknown;
  profileDir?: string | null;
}) {
  await bibDisconnectAccount(acc.id, false);
  await sleep(800);
  await bibLaunchAccount(acc.id, {
    maxSlots: acc.maxParallelLimit || 5,
    projectIds: Array.isArray(acc.flowProjectIds) ? (acc.flowProjectIds as string[]) : [],
    profileDir: acc.profileDir,
  });
  for (let i = 0; i < 8; i++) {
    await sleep(750);
    try {
      const st = await bibAccountStatus(acc.id);
      if (st?.running || st?.status === 'READY' || st?.status === 'NEEDS_LOGIN') break;
    } catch {
      /* retry */
    }
  }
}

async function listRelaunchTargets(onlyAccountId?: string) {
  const accounts = await prisma.providerAccount.findMany({
    where: onlyAccountId
      ? { id: onlyAccountId }
      : {
          OR: [
            { browserStatus: BrowserStatus.READY },
            { browserStatus: BrowserStatus.NEEDS_LOGIN },
            { browserStatus: BrowserStatus.STARTING },
            { profileDir: { not: null } },
          ],
        },
    select: {
      id: true,
      maxParallelLimit: true,
      flowProjectIds: true,
      profileDir: true,
      browserStatus: true,
    },
  });

  if (onlyAccountId) return accounts;

  let liveIds: string[] = [];
  try {
    const r = await bibFetch('/accounts');
    const data = await r.json().catch(() => ({}));
    liveIds = Array.isArray(data.accounts)
      ? data.accounts
          .filter((a: any) => a?.running || a?.status === 'READY' || a?.status === 'NEEDS_LOGIN')
          .map((a: any) => a.accountId)
      : [];
  } catch {
    /* ignore */
  }

  if (liveIds.length > 0) return accounts.filter((a) => liveIds.includes(a.id));
  return accounts.filter(
    (a) =>
      a.browserStatus === BrowserStatus.READY ||
      a.browserStatus === BrowserStatus.NEEDS_LOGIN ||
      !!a.profileDir
  );
}

/**
 * Rotate ONE account onto a different unique proxy and relaunch that Chrome only.
 * Used after unusual-activity: retry → rotate this account → retry again.
 */
export async function rotateProxyAndRelaunchForAccount(
  accountId: string,
  opts?: { reason?: string }
): Promise<{
  ok: boolean;
  rotated: boolean;
  from: string | null;
  to: string | null;
  relaunched: number;
  error?: string;
}> {
  if (!accountId) {
    return { ok: false, rotated: false, from: null, to: null, relaunched: 0, error: 'accountId required' };
  }
  if (rotating) {
    return {
      ok: false,
      rotated: false,
      from: null,
      to: getProxyUrlSafe(accountId),
      relaunched: 0,
      error: 'Rotation already in progress',
    };
  }

  rotating = true;
  try {
    const rotated = rotateProxyForAccount(accountId);
    if (!rotated.ok || !rotated.to) {
      return {
        ok: false,
        rotated: false,
        from: rotated.from,
        to: rotated.to,
        relaunched: 0,
        error: rotated.error || 'Need ≥2 enabled proxies to rotate',
      };
    }

    console.warn(
      `[proxy-rotate] account ${accountId.slice(0, 8)} ${opts?.reason || 'manual'} → ${maskProxyUrl(rotated.to)}`
    );

    try {
      await bibFetch('/egress-proxy/clear-cache', { method: 'POST', body: '{}' });
    } catch (e) {
      console.warn('[proxy-rotate] clear-cache:', e);
    }

    const targets = await listRelaunchTargets(accountId);
    let relaunched = 0;
    for (const acc of targets) {
      try {
        await relaunchAccount(acc);
        relaunched += 1;
      } catch (e) {
        console.warn(`[proxy-rotate] relaunch ${acc.id}:`, e);
      }
    }

    writeSiteRuntimePatch({
      lastProxyRotateAt: new Date().toISOString(),
      lastProxyRotateReason: String(opts?.reason || `account ${accountId.slice(0, 8)}`).slice(0, 120),
      unusualActivityStreak: 0,
    });

    return {
      ok: true,
      rotated: true,
      from: rotated.from,
      to: rotated.to,
      relaunched,
    };
  } finally {
    rotating = false;
  }
}

function getProxyUrlSafe(accountId: string): string | null {
  return getProxyUrlForAccount(accountId);
}

/**
 * Manual / auto-timer: rotate pool order, reassign unique proxies to live accounts, relaunch all.
 */
export async function performEgressProxyRotateAndRelaunch(opts?: {
  reason?: string;
}): Promise<{
  ok: boolean;
  rotated: boolean;
  from: string | null;
  to: string | null;
  relaunched: number;
  error?: string;
  reason?: string;
}> {
  if (rotating) {
    return {
      ok: false,
      rotated: false,
      from: null,
      to: activeEgressProxyUrl(readEgressProxyMirror().proxies),
      relaunched: 0,
      error: 'Rotation already in progress',
    };
  }

  rotating = true;
  try {
    const rotated = rotateActiveEgressProxy();
    if (!rotated.ok || !rotated.to) {
      return {
        ok: false,
        rotated: false,
        from: rotated.from,
        to: rotated.to,
        relaunched: 0,
        error: 'Need ≥2 enabled proxies to rotate',
      };
    }

    console.warn(
      `[proxy-rotate] ${opts?.reason || 'manual'} → ${maskProxyUrl(rotated.to || '')}`
    );

    try {
      await bibFetch('/egress-proxy/clear-cache', { method: 'POST', body: '{}' });
    } catch (e) {
      console.warn('[proxy-rotate] clear-cache:', e);
    }

    const targets = await listRelaunchTargets();
    reassignUniqueProxies(targets.map((a) => a.id));

    let relaunched = 0;
    for (const acc of targets) {
      try {
        await relaunchAccount(acc);
        relaunched += 1;
      } catch (e) {
        console.warn(`[proxy-rotate] relaunch ${acc.id}:`, e);
      }
    }

    writeSiteRuntimePatch({
      lastProxyRotateAt: new Date().toISOString(),
      lastProxyRotateReason: String(opts?.reason || 'manual').slice(0, 120),
      unusualActivityStreak: 0,
    });

    return {
      ok: true,
      rotated: true,
      from: rotated.from,
      to: rotated.to,
      relaunched,
      reason: opts?.reason || 'manual',
    };
  } finally {
    rotating = false;
  }
}

/**
 * Legacy streak helper — unusual flow now lives in withSystemErrorRetry
 * (retry → rotate account proxy → retry). Kept for video status hooks.
 */
export async function noteUnusualActivityFailure(
  errorMessage: unknown,
  accountId?: string
): Promise<{
  rotated: boolean;
  streak: number;
  proxy?: string | null;
}> {
  if (!isUnusualActivityError(errorMessage)) {
    return { rotated: false, streak: getUnusualActivityStreak() };
  }
  if (accountId) {
    const result = await rotateProxyAndRelaunchForAccount(accountId, {
      reason: 'unusual activity',
    });
    return {
      rotated: result.rotated,
      streak: 0,
      proxy: result.to,
    };
  }
  return { rotated: false, streak: getUnusualActivityStreak() };
}
