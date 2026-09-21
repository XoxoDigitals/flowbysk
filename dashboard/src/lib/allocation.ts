import { prisma } from './prisma';
import { BrowserStatus, JobStatus, ProviderStatus } from '@prisma/client';

/** User considered offline if no heartbeat within this window. */
export const ONLINE_WINDOW_MS = 15 * 60 * 1000;

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.IN_QUEUE,
  JobStatus.PREPARING,
  JobStatus.GENERATING,
  JobStatus.RETRYING,
  JobStatus.CHECKING_STATUS,
];

export function isUserOnline(lastSeenAt: Date | null | undefined, now = Date.now()): boolean {
  if (!lastSeenAt) return false;
  return now - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}

async function userHasActiveJobs(userId: string): Promise<boolean> {
  const n = await prisma.generationJob.count({
    where: { userId, status: { in: ACTIVE_JOB_STATUSES } },
  });
  return n > 0;
}

function accountLimit(maxParallelLimit: number | null | undefined): number {
  return maxParallelLimit && maxParallelLimit > 0 ? maxParallelLimit : 5;
}

/**
 * Pick the least-loaded HEALTHY account that still has a free user slot.
 */
async function pickLeastLoadedAccount(excludeAccountId?: string | null) {
  const accounts = await prisma.providerAccount.findMany({
    where: {
      status: ProviderStatus.HEALTHY,
      ...(excludeAccountId ? { id: { not: excludeAccountId } } : {}),
    },
    include: {
      assignedUsers: { select: { id: true } },
      generationJobs: {
        where: { status: { in: ACTIVE_JOB_STATUSES } },
        select: { userId: true },
      },
    },
  });

  const scored = accounts
    .map((acc) => {
      const used = acc.assignedUsers.length;
      const limit = accountLimit(acc.maxParallelLimit);
      return {
        id: acc.id,
        used,
        limit,
        free: Math.max(0, limit - used),
        load: used + acc.generationJobs.length * 0.5,
      };
    })
    .filter((a) => a.free > 0)
    .sort((a, b) => a.load - b.load);

  return scored[0]?.id || null;
}

/**
 * Move an automatic (non-manual) user to another healthy account with free capacity.
 * Clears assignment if nowhere to go (they will re-allocate on next login).
 */
export async function relocateAutomaticUser(
  userId: string,
  excludeAccountId?: string | null
): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      providerAssignmentManual: true,
      assignedProviderAccountId: true,
    },
  });
  if (!user || user.providerAssignmentManual) return null;

  const nextId = await pickLeastLoadedAccount(excludeAccountId || user.assignedProviderAccountId);
  const sameAccount = nextId === user.assignedProviderAccountId;
  await prisma.user.update({
    where: { id: userId },
    data: {
      assignedProviderAccountId: nextId,
      ...(sameAccount ? {} : { assignedFlowProjectId: null }),
      providerAssignmentManual: false,
    },
  });
  return nextId;
}

/**
 * Free slots on an account by relocating automatic users (never touches manual pins).
 * Prefers offline / idle users first.
 */
export async function freeSlotsOnAccount(
  accountId: string,
  slotsNeeded: number,
  protectUserId?: string | null
): Promise<number> {
  if (slotsNeeded <= 0) return 0;

  const assigned = await prisma.user.findMany({
    where: {
      assignedProviderAccountId: accountId,
      providerAssignmentManual: false,
      ...(protectUserId ? { id: { not: protectUserId } } : {}),
    },
    select: { id: true, lastSeenAt: true },
  });

  const ranked = [...assigned].sort((a, b) => {
    const aOnline = isUserOnline(a.lastSeenAt) ? 1 : 0;
    const bOnline = isUserOnline(b.lastSeenAt) ? 1 : 0;
    return aOnline - bOnline;
  });

  let freed = 0;
  for (const u of ranked) {
    if (freed >= slotsNeeded) break;
    if (await userHasActiveJobs(u.id)) continue;
    await relocateAutomaticUser(u.id, accountId);
    freed++;
  }

  // If still need slots and only online autos left, relocate them too (manual stays)
  if (freed < slotsNeeded) {
    for (const u of ranked) {
      if (freed >= slotsNeeded) break;
      const still = await prisma.user.findUnique({
        where: { id: u.id },
        select: { assignedProviderAccountId: true, providerAssignmentManual: true },
      });
      if (still?.providerAssignmentManual) continue;
      if (still?.assignedProviderAccountId !== accountId) continue;
      await relocateAutomaticUser(u.id, accountId);
      freed++;
    }
  }

  return freed;
}

/**
 * Admin: pin user to a specific account (manual) or clear to Automatic.
 * Manual pins are never auto-changed. When pinning onto a full account,
 * automatic users on that account are relocated to free a slot.
 */
export async function setUserProviderAssignment(
  userId: string,
  accountId: string | null
): Promise<{ assignedProviderAccountId: string | null; providerAssignmentManual: boolean }> {
  if (!accountId) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        assignedProviderAccountId: null,
        assignedFlowProjectId: null,
        providerAssignmentManual: false,
      },
    });
    const allocated = await allocateProviderAccountForUser(userId);
    return {
      assignedProviderAccountId: allocated,
      providerAssignmentManual: false,
    };
  }

  const account = await prisma.providerAccount.findUnique({
    where: { id: accountId },
    include: { assignedUsers: { select: { id: true } } },
  });
  if (!account) {
    throw new Error('Provider account not found');
  }

  const limit = accountLimit(account.maxParallelLimit);
  const others = account.assignedUsers.filter((u) => u.id !== userId).length;
  if (others + 1 > limit) {
    await freeSlotsOnAccount(accountId, others + 1 - limit, userId);
  }

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { assignedProviderAccountId: true },
  });
  const sameAccount = existing?.assignedProviderAccountId === accountId;

  await prisma.user.update({
    where: { id: userId },
    data: {
      assignedProviderAccountId: accountId,
      ...(sameAccount ? {} : { assignedFlowProjectId: null }),
      providerAssignmentManual: true,
    },
  });

  return { assignedProviderAccountId: accountId, providerAssignmentManual: true };
}

/**
 * Ensure the user has a provider account assigned (called on login / session start).
 * Manual pins are never changed. Automatic assignments stay while healthy; otherwise re-pick.
 */
export async function allocateProviderAccountForUser(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      providerAssignmentManual: true,
      assignedProviderAccountId: true,
      assignedProviderAccount: { select: { id: true, status: true, maxParallelLimit: true } },
    },
  });
  if (!user) return null;

  // Manual pin: never relocate, even if account is unhealthy
  if (user.providerAssignmentManual && user.assignedProviderAccountId) {
    return user.assignedProviderAccountId;
  }

  if (user.assignedProviderAccountId && user.assignedProviderAccount?.status === ProviderStatus.HEALTHY) {
    // Prefer staying if account is READY; if not READY, re-pick when possible
    const sticky = await prisma.providerAccount.findUnique({
      where: { id: user.assignedProviderAccountId },
      select: { browserStatus: true, status: true },
    });
    if (sticky?.status === ProviderStatus.HEALTHY && sticky.browserStatus === BrowserStatus.READY) {
      return user.assignedProviderAccountId;
    }
  }

  // Prefer READY browsers among healthy accounts
  const ready = await prisma.providerAccount.findMany({
    where: { status: ProviderStatus.HEALTHY, browserStatus: BrowserStatus.READY },
    include: { assignedUsers: { select: { id: true } } },
  });
  const scored = ready
    .map((acc) => {
      const used = acc.assignedUsers.length;
      const limit = accountLimit(acc.maxParallelLimit);
      return { id: acc.id, free: Math.max(0, limit - used), load: used };
    })
    .filter((a) => a.free > 0)
    .sort((a, b) => a.load - b.load);
  let accountId = scored[0]?.id || null;
  if (!accountId) {
    accountId = await pickLeastLoadedAccount();
  }
  if (!accountId) {
    console.warn(`[allocation] No healthy account with free slots for user ${userId}`);
    return null;
  }

  // Keep Flow project pin when staying on the same Google account
  const sameAccount = user.assignedProviderAccountId === accountId;
  await prisma.user.update({
    where: { id: userId },
    data: {
      assignedProviderAccountId: accountId,
      ...(sameAccount ? {} : { assignedFlowProjectId: null }),
      providerAssignmentManual: false,
    },
  });

  return accountId;
}

/**
 * Release assignment when the user has no active/queued jobs AND is offline.
 * Manual pins are never released.
 */
export async function releaseProviderAccountIfIdle(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      assignedProviderAccountId: true,
      providerAssignmentManual: true,
      lastSeenAt: true,
    },
  });
  if (!user?.assignedProviderAccountId) return false;
  if (user.providerAssignmentManual) return false;

  if (await userHasActiveJobs(userId)) return false;
  if (isUserOnline(user.lastSeenAt)) return false;

  await prisma.user.update({
    where: { id: userId },
    data: {
      assignedProviderAccountId: null,
      assignedFlowProjectId: null,
      providerAssignmentManual: false,
    },
  });
  return true;
}

/**
 * Emergency failover: move ALL non-manual users off a dead account onto remaining
 * READY/HEALTHY accounts equally — capacity limits are ignored during this pass.
 */
export async function redistributeUsersFromAccount(deadAccountId: string): Promise<{
  moved: number;
  targets: string[];
}> {
  const users = await prisma.user.findMany({
    where: {
      assignedProviderAccountId: deadAccountId,
      providerAssignmentManual: false,
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  const targets = await prisma.providerAccount.findMany({
    where: {
      id: { not: deadAccountId },
      status: ProviderStatus.HEALTHY,
      OR: [
        { browserStatus: BrowserStatus.READY },
        { browserStatus: BrowserStatus.NEEDS_LOGIN }, // still prefer healthy status pool
      ],
    },
    select: {
      id: true,
      browserStatus: true,
      assignedUsers: { select: { id: true } },
    },
  });

  // Prefer READY browsers; fall back to any HEALTHY
  let pool = targets.filter((t) => t.browserStatus === BrowserStatus.READY);
  if (pool.length === 0) {
    pool = await prisma.providerAccount.findMany({
      where: { id: { not: deadAccountId }, status: ProviderStatus.HEALTHY },
      select: {
        id: true,
        browserStatus: true,
        assignedUsers: { select: { id: true } },
      },
    });
  }

  if (pool.length === 0) {
    // Nowhere to go — clear sticky so login can re-pick later
    for (const u of users) {
      await prisma.user.update({
        where: { id: u.id },
        data: { assignedProviderAccountId: null, assignedFlowProjectId: null, providerAssignmentManual: false },
      });
    }
    return { moved: users.length, targets: [] };
  }

  // Equalize: assign each user to the currently least-loaded target (ignore maxParallelLimit)
  const loads = new Map(pool.map((p) => [p.id, p.assignedUsers.length]));
  let moved = 0;
  for (const u of users) {
    let bestId = pool[0].id;
    let bestLoad = loads.get(bestId) ?? 0;
    for (const p of pool) {
      const load = loads.get(p.id) ?? 0;
      if (load < bestLoad) {
        bestLoad = load;
        bestId = p.id;
      }
    }
    await prisma.user.update({
      where: { id: u.id },
      data: {
        assignedProviderAccountId: bestId,
        assignedFlowProjectId: null,
        providerAssignmentManual: false,
      },
    });
    loads.set(bestId, (loads.get(bestId) ?? 0) + 1);
    moved++;
  }

  return { moved, targets: pool.map((p) => p.id) };
}

/**
 * Mark provider expired and redistribute automatic users.
 */
export async function handleProviderAuthLost(accountId: string, errorMessage?: string) {
  await prisma.providerAccount.update({
    where: { id: accountId },
    data: {
      status: ProviderStatus.CREDENTIALS_EXPIRED,
      browserStatus: BrowserStatus.NEEDS_LOGIN,
      bibLastError: errorMessage || 'Google session lost',
      lastErrorMessage: errorMessage || 'Google session lost',
      lastHealthCheck: new Date(),
    },
  });
  return redistributeUsersFromAccount(accountId);
}

/**
 * Sweep: release automatic users who are offline with no active jobs.
 */
export async function releaseIdleOfflineAllocations(): Promise<number> {
  const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
  const candidates = await prisma.user.findMany({
    where: {
      assignedProviderAccountId: { not: null },
      providerAssignmentManual: false,
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }],
    },
    select: { id: true },
    take: 200,
  });

  let released = 0;
  for (const u of candidates) {
    if (await releaseProviderAccountIfIdle(u.id)) released++;
  }
  return released;
}
