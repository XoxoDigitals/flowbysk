import { prisma } from './prisma';
import { BrowserStatus } from '@prisma/client';
import {
  maskProxyUrl,
  rotateActiveEgressProxy,
  readEgressProxyMirror,
  activeEgressProxyUrl,
} from './egressProxy';
import {
  bibDisconnectAccount,
  bibFetch,
  bibLaunchAccount,
  bibAccountStatus,
} from './bib';
import { writeSiteRuntimePatch } from './siteRuntime';

let consecutiveUnusual = 0;
let rotating = false;

const UNUSUAL_RE =
  /UNUSUAL_ACTIVITY|TOO_MUCH_TRAFFIC|RECAPTCHA|unusual\s*activity/i;

export function isUnusualActivityError(raw: unknown): boolean {
  return UNUSUAL_RE.test(String(raw ?? ''));
}

export function resetUnusualActivityStreak(): void {
  consecutiveUnusual = 0;
}

export function getUnusualActivityStreak(): number {
  return consecutiveUnusual;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Rotate active egress proxy and relaunch BiB Chromes on the same profiles
 * (cookies preserved — no Google logout). Clears BiB proxy cache first.
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

    const accounts = await prisma.providerAccount.findMany({
      where: {
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

    const targets =
      liveIds.length > 0
        ? accounts.filter((a) => liveIds.includes(a.id))
        : accounts.filter(
            (a) =>
              a.browserStatus === BrowserStatus.READY ||
              a.browserStatus === BrowserStatus.NEEDS_LOGIN ||
              !!a.profileDir
          );

    let relaunched = 0;
    for (const acc of targets) {
      try {
        // clearProfile=false keeps Google cookies in userDataDir
        await bibDisconnectAccount(acc.id, false);
        await sleep(800);
        await bibLaunchAccount(acc.id, {
          maxSlots: acc.maxParallelLimit || 5,
          projectIds: Array.isArray(acc.flowProjectIds)
            ? (acc.flowProjectIds as string[])
            : [],
          profileDir: acc.profileDir,
        });
        // Wait briefly for Chrome to come up before next jobs hit generate
        for (let i = 0; i < 8; i++) {
          await sleep(750);
          try {
            const st = await bibAccountStatus(acc.id);
            if (st?.running || st?.status === 'READY' || st?.status === 'NEEDS_LOGIN') break;
          } catch {
            /* retry */
          }
        }
        relaunched += 1;
      } catch (e) {
        console.warn(`[proxy-rotate] relaunch ${acc.id}:`, e);
      }
    }

    writeSiteRuntimePatch({ lastProxyRotateAt: new Date().toISOString() });
    consecutiveUnusual = 0;

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

/**
 * Call on generation failure. After 3 consecutive unusual-activity errors,
 * rotate egress proxy and relaunch BiB Chromes.
 */
export async function noteUnusualActivityFailure(errorMessage: unknown): Promise<{
  rotated: boolean;
  streak: number;
  proxy?: string | null;
}> {
  if (!isUnusualActivityError(errorMessage)) {
    return { rotated: false, streak: consecutiveUnusual };
  }
  consecutiveUnusual += 1;
  if (consecutiveUnusual < 3 || rotating) {
    return { rotated: false, streak: consecutiveUnusual };
  }

  const result = await performEgressProxyRotateAndRelaunch({
    reason: `unusual activity ×${consecutiveUnusual}`,
  });
  consecutiveUnusual = 0;
  return {
    rotated: result.rotated,
    streak: 0,
    proxy: result.to,
  };
}
