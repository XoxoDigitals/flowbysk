import { prisma } from './prisma';
import { BrowserStatus } from '@prisma/client';
import {
  maskProxyUrl,
  rotateActiveEgressProxy,
} from './egressProxy';
import {
  bibDisconnectAccount,
  bibFetch,
  bibLaunchAccount,
} from './bib';

let consecutiveUnusual = 0;
let rotating = false;

const UNUSUAL_RE = /UNUSUAL_ACTIVITY|RECAPTCHA|unusual\s*activity/i;

export function isUnusualActivityError(raw: unknown): boolean {
  return UNUSUAL_RE.test(String(raw ?? ''));
}

export function resetUnusualActivityStreak(): void {
  consecutiveUnusual = 0;
}

export function getUnusualActivityStreak(): number {
  return consecutiveUnusual;
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

  rotating = true;
  try {
    const rotated = rotateActiveEgressProxy();
    if (!rotated.ok || !rotated.to) {
      console.warn(
        `[proxy-rotate] unusual streak=${consecutiveUnusual} but need ≥2 enabled proxies`
      );
      consecutiveUnusual = 0;
      return { rotated: false, streak: 0, proxy: rotated.to };
    }

    console.warn(
      `[proxy-rotate] unusual activity ×${consecutiveUnusual} → ${maskProxyUrl(rotated.to || '')}`
    );

    // Clear BiB resolve cache then relaunch running accounts
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
          { profileDir: { not: null } },
        ],
      },
      select: {
        id: true,
        maxParallelLimit: true,
        flowProjectIds: true,
        profileDir: true,
      },
    });

    // Prefer live BiB pool if available
    let liveIds: string[] = [];
    try {
      const r = await bibFetch('/accounts');
      const data = await r.json().catch(() => ({}));
      liveIds = Array.isArray(data.accounts)
        ? data.accounts.filter((a: any) => a?.running || a?.status === 'READY').map((a: any) => a.accountId)
        : [];
    } catch {
      /* ignore */
    }

    const targets =
      liveIds.length > 0
        ? accounts.filter((a) => liveIds.includes(a.id))
        : accounts.filter((a) => a.browserStatus === BrowserStatus.READY);

    for (const acc of targets) {
      try {
        await bibDisconnectAccount(acc.id, false);
        await bibLaunchAccount(acc.id, {
          maxSlots: acc.maxParallelLimit || 5,
          projectIds: Array.isArray(acc.flowProjectIds)
            ? (acc.flowProjectIds as string[])
            : [],
          profileDir: acc.profileDir,
        });
      } catch (e) {
        console.warn(`[proxy-rotate] relaunch ${acc.id}:`, e);
      }
    }

    consecutiveUnusual = 0;
    return { rotated: true, streak: 0, proxy: rotated.to };
  } finally {
    rotating = false;
  }
}
