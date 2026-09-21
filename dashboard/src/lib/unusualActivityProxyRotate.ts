import fs from 'fs';
import path from 'path';
import { prisma } from './prisma';
import { BrowserStatus, JobStatus } from '@prisma/client';
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

const PENDING_RELAUNCH_PATH = path.join(process.cwd(), 'data', 'proxy-pending-relaunch.json');

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.PREPARING,
  JobStatus.GENERATING,
  JobStatus.CHECKING_STATUS,
  JobStatus.RETRYING,
];

const UNUSUAL_RE =
  /UNUSUAL_ACTIVITY|TOO_MUCH_TRAFFIC|RECAPTCHA|unusual\s*activity|mediaId could not be parsed|Upload submitted but mediaId|batchexecute error e=4|\be\s*=\s*4\b/i;

export function isUnusualActivityError(raw: unknown): boolean {
  return UNUSUAL_RE.test(String(raw ?? ''));
}

type PendingRelaunchMap = Record<
  string,
  { pending: boolean; reason?: string; at?: string; deadTunnel?: boolean }
>;

function readPendingRelaunchMap(): PendingRelaunchMap {
  try {
    if (!fs.existsSync(PENDING_RELAUNCH_PATH)) return {};
    const raw = JSON.parse(fs.readFileSync(PENDING_RELAUNCH_PATH, 'utf8'));
    return raw && typeof raw === 'object' ? (raw as PendingRelaunchMap) : {};
  } catch {
    return {};
  }
}

function writePendingRelaunchMap(map: PendingRelaunchMap): void {
  try {
    fs.mkdirSync(path.dirname(PENDING_RELAUNCH_PATH), { recursive: true });
    fs.writeFileSync(PENDING_RELAUNCH_PATH, JSON.stringify(map, null, 2), 'utf8');
  } catch (e) {
    console.warn('[proxy-rotate] pending relaunch write failed:', e);
  }
}

export function setPendingProxyRelaunch(
  accountId: string,
  opts?: { reason?: string; deadTunnel?: boolean }
): void {
  if (!accountId) return;
  const map = readPendingRelaunchMap();
  map[accountId] = {
    pending: true,
    reason: String(opts?.reason || 'deferred').slice(0, 120),
    at: new Date().toISOString(),
    deadTunnel: !!opts?.deadTunnel,
  };
  writePendingRelaunchMap(map);
}

export function clearPendingProxyRelaunch(accountId: string): void {
  if (!accountId) return;
  const map = readPendingRelaunchMap();
  if (!map[accountId]) return;
  delete map[accountId];
  writePendingRelaunchMap(map);
}

export function hasPendingProxyRelaunch(accountId: string): boolean {
  return !!readPendingRelaunchMap()[accountId]?.pending;
}

/** Active sibling jobs on this Google account (shared BiB Chrome). */
export async function countActiveJobsForAccount(
  accountId: string,
  exceptJobId?: string | null
): Promise<number> {
  if (!accountId) return 0;
  return prisma.generationJob.count({
    where: {
      providerAccountId: accountId,
      status: { in: ACTIVE_JOB_STATUSES },
      ...(exceptJobId ? { id: { not: exceptJobId } } : {}),
    },
  });
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

export type RotateAccountOpts = {
  reason?: string;
  /** Job that triggered rotate — excluded from sibling count. */
  exceptJobId?: string | null;
  /** Admin force: relaunch even if siblings are GENERATING. */
  forceRelaunch?: boolean;
  /** Tunnel/proxy dead — relaunch allowed with siblings (polls already broken). */
  deadTunnel?: boolean;
};

/**
 * Rotate ONE account onto a different unique proxy.
 * Assigns new sticky always; relaunches Chrome only when safe
 * (no sibling active jobs), unless forceRelaunch / deadTunnel.
 */
export async function rotateProxyAndRelaunchForAccount(
  accountId: string,
  opts?: RotateAccountOpts
): Promise<{
  ok: boolean;
  rotated: boolean;
  deferred?: boolean;
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

    const siblings = await countActiveJobsForAccount(accountId, opts?.exceptJobId);
    const allowRelaunch = !!opts?.forceRelaunch || !!opts?.deadTunnel || siblings === 0;

    if (!allowRelaunch) {
      setPendingProxyRelaunch(accountId, {
        reason: opts?.reason || 'deferred siblings',
        deadTunnel: false,
      });
      console.warn(
        `[proxy-rotate] deferred relaunch account ${accountId.slice(0, 8)} — ${siblings} sibling job(s) still active`
      );
      writeSiteRuntimePatch({
        lastProxyRotateAt: new Date().toISOString(),
        lastProxyRotateReason: String(
          opts?.reason || `account ${accountId.slice(0, 8)} deferred`
        ).slice(0, 120),
        unusualActivityStreak: 0,
      });
      return {
        ok: true,
        rotated: true,
        deferred: true,
        from: fromBefore,
        to: toUrl,
        relaunched: 0,
      };
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
    clearPendingProxyRelaunch(accountId);

    writeSiteRuntimePatch({
      lastProxyRotateAt: new Date().toISOString(),
      lastProxyRotateReason: String(opts?.reason || `account ${accountId.slice(0, 8)}`).slice(0, 120),
      unusualActivityStreak: 0,
    });

    return {
      ok: true,
      rotated: true,
      deferred: false,
      from: fromBefore,
      to: toUrl,
      relaunched,
    };
  } finally {
    rotating = false;
  }
}

/**
 * After a job reaches terminal state: if this account has pending relaunch
 * and no remaining active jobs, apply the deferred Chrome relaunch.
 */
export async function drainPendingProxyRelaunch(accountId?: string | null): Promise<void> {
  if (!accountId) return;
  if (!hasPendingProxyRelaunch(accountId)) return;
  const active = await countActiveJobsForAccount(accountId);
  if (active > 0) {
    console.warn(
      `[proxy-rotate] drain skip ${accountId.slice(0, 8)} — ${active} still active`
    );
    return;
  }
  if (rotating) return;

  rotating = true;
  try {
    const pending = readPendingRelaunchMap()[accountId];
    console.warn(
      `[proxy-rotate] draining deferred relaunch for ${accountId.slice(0, 8)} (${pending?.reason || 'pending'})`
    );
    try {
      await bibFetch('/egress-proxy/clear-cache', { method: 'POST', body: '{}' });
    } catch {
      /* ignore */
    }
    const targets = await listRelaunchTargets(accountId);
    for (const acc of targets) {
      try {
        await relaunchAccount(acc);
      } catch (e) {
        console.warn(`[proxy-rotate] drain relaunch ${acc.id}:`, e);
      }
    }
    clearPendingProxyRelaunch(accountId);
    writeSiteRuntimePatch({
      lastProxyRotateAt: new Date().toISOString(),
      lastProxyRotateReason: `drain ${accountId.slice(0, 8)}`,
      unusualActivityStreak: 0,
    });
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
  accountId?: string,
  exceptJobId?: string | null
): Promise<{
  rotated: boolean;
  deferred?: boolean;
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
      exceptJobId,
    });
    return {
      rotated: result.rotated,
      deferred: result.deferred,
      streak: 0,
      proxy: result.to,
    };
  }
  return { rotated: false, streak: getUnusualActivityStreak() };
}
