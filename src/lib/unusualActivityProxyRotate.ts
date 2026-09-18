import { prisma } from './prisma';
import { BrowserStatus } from '@prisma/client';
import {
  maskProxyUrl,
  rotateActiveEgressProxy,
  rotateProxyForAccount,
  reassignUniqueProxies,
  ensureStickyUniqueAssignments,
  ensureUniqueProxyForAccount,
  readEgressProxyMirror,
  activeEgressProxyUrl,
  getProxyUrlForAccount,
} from './egressProxy';
import {
  allocateDataImpulseForAccount,
  isDataImpulseReady,
  reassignAllDataImpulse,
  rotateDataImpulseAccount,
} from './dataimpulse';
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
    const fromBefore = getProxyUrlSafe(accountId);
    let toUrl: string | null = null;

    if (isDataImpulseReady()) {
      const di = rotateDataImpulseAccount(accountId);
      if (!di?.url) {
        return {
          ok: false,
          rotated: false,
          from: fromBefore,
          to: null,
          relaunched: 0,
          error: 'DataImpulse rotate failed',
        };
      }
      toUrl = di.url;
      try {
        const { recordProxyOutcome } = await import('./dataimpulse');
        recordProxyOutcome({
          event: 'rotate',
          accountId,
          country: di.country,
          sessId: di.sessId,
          port: di.port,
        });
      } catch {
        /* ignore */
      }
      console.warn(
        `[proxy-rotate] DataImpulse account ${accountId.slice(0, 8)} ${opts?.reason || 'manual'} cr.${di.country} → ${maskProxyUrl(di.url)}`
      );
    } else {
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
      toUrl = rotated.to;
      console.warn(
        `[proxy-rotate] account ${accountId.slice(0, 8)} ${opts?.reason || 'manual'} → ${maskProxyUrl(rotated.to)}`
      );
    }

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
      from: fromBefore,
      to: toUrl,
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
 * Rotate pool + reassign unique proxies to live accounts, then relaunch BiB.
 * - sticky:false (default / auto-rotate setting on): shuffle — each account gets a new unique proxy.
 * - sticky:true: keep existing unique assignments; only fill gaps / fix collisions.
 * BiB Chrome and Python both resolve via assignments[accountId] after relaunch.
 */
export async function performEgressProxyRotateAndRelaunch(opts?: {
  reason?: string;
  sticky?: boolean;
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
    const sticky = !!opts?.sticky;
    const diReady = isDataImpulseReady();
    let from: string | null = activeEgressProxyUrl(readEgressProxyMirror().proxies);
    let to: string | null = from;

    if (diReady) {
      console.warn(
        `[proxy-rotate] DataImpulse ${opts?.reason || 'manual'} ${sticky ? 'sticky ensure' : 'reshuffle sessids'}`
      );
    } else if (!sticky) {
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
      from = rotated.from;
      to = rotated.to;
      console.warn(
        `[proxy-rotate] ${opts?.reason || 'manual'} → ${maskProxyUrl(rotated.to || '')}`
      );
    } else {
      console.warn(`[proxy-rotate] ${opts?.reason || 'auto'} sticky unique ensure`);
    }

    try {
      await bibFetch('/egress-proxy/clear-cache', { method: 'POST', body: '{}' });
    } catch (e) {
      console.warn('[proxy-rotate] clear-cache:', e);
    }

    const targets = await listRelaunchTargets();
    const targetIds = targets.map((a) => a.id);
    let relaunchIds = targetIds;

    if (diReady) {
      if (sticky) {
        const changed: string[] = [];
        for (const id of targetIds) {
          const before = getProxyUrlForAccount(id);
          const r = allocateDataImpulseForAccount(id);
          if (r && (!before || before !== r.url)) changed.push(id);
        }
        relaunchIds = changed;
        to = targetIds.length ? getProxyUrlForAccount(targetIds[0]) : to;
        if (!relaunchIds.length) {
          writeSiteRuntimePatch({
            lastProxyRotateAt: new Date().toISOString(),
            lastProxyRotateReason: String(opts?.reason || 'auto sticky DI').slice(0, 120),
            unusualActivityStreak: 0,
          });
          return {
            ok: true,
            rotated: false,
            from,
            to,
            relaunched: 0,
            reason: opts?.reason || 'auto sticky',
          };
        }
      } else {
        reassignAllDataImpulse(targetIds);
        to = targetIds.length ? getProxyUrlForAccount(targetIds[0]) : to;
      }
    } else if (sticky) {
      const { changed } = ensureStickyUniqueAssignments(targetIds);
      for (const id of targetIds) {
        if (!getProxyUrlForAccount(id)) {
          ensureUniqueProxyForAccount(id);
          if (!changed.includes(id)) changed.push(id);
        }
      }
      relaunchIds = changed.length ? targets.filter((a) => changed.includes(a.id)).map((a) => a.id) : [];
      to = activeEgressProxyUrl(readEgressProxyMirror().proxies);
      if (!relaunchIds.length) {
        writeSiteRuntimePatch({
          lastProxyRotateAt: new Date().toISOString(),
          lastProxyRotateReason: String(opts?.reason || 'auto sticky').slice(0, 120),
          unusualActivityStreak: 0,
        });
        return {
          ok: true,
          rotated: false,
          from,
          to,
          relaunched: 0,
          reason: opts?.reason || 'auto sticky',
        };
      }
    } else {
      reassignUniqueProxies(targetIds);
    }

    let relaunched = 0;
    for (const acc of targets) {
      if (sticky && !relaunchIds.includes(acc.id)) continue;
      try {
        await relaunchAccount(acc);
        relaunched += 1;
      } catch (e) {
        console.warn(`[proxy-rotate] relaunch ${acc.id}:`, e);
      }
    }

    writeSiteRuntimePatch({
      lastProxyRotateAt: new Date().toISOString(),
      lastProxyRotateReason: String(opts?.reason || (sticky ? 'auto sticky' : 'manual')).slice(0, 120),
      unusualActivityStreak: 0,
    });

    return {
      ok: true,
      rotated: !sticky,
      from,
      to,
      relaunched,
      reason: opts?.reason || (sticky ? 'auto sticky' : 'manual'),
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
  try {
    const { recordProxyOutcome } = await import('./dataimpulse');
    recordProxyOutcome({ event: 'unusual', accountId });
  } catch {
    /* ignore */
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
