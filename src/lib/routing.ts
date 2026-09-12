import { prisma } from './prisma';
import { WalletType, ProviderStatus, CreditClassification, JobStatus, BrowserStatus } from '@prisma/client';

/** Max sticky SaaS users that may share one Google provider account (admin "user slots"). */
export const MAX_USERS_PER_ACCOUNT = 25;

export interface AccountAllocationStats {
  id: string;
  label: string;
  accountEmail: string | null;
  status: ProviderStatus;
  creditClassification: CreditClassification;
  googleCreditsBalance: number;
  googleCreditsReserved: number;
  activeUsersCount: number;
  maxUsersLimit: number;
  activeGenerationsCount: number;
  availableUserSlots: number;
  loadScore: number;
  assignedUsers: {
    id: string;
    name: string | null;
    email: string;
    lastSeenAt: Date | null;
    isOnline: boolean;
    hasActiveJobs: boolean;
    isManual: boolean;
    assignedFlowProjectId?: string | null;
  }[];
  onlineAssignedCount: number;
}

/**
 * Retrieves real-time allocation statistics for all provider accounts,
 * including sticky user count and running parallel generations.
 */
export async function getAccountsAllocationStats(): Promise<AccountAllocationStats[]> {
  const { isUserOnline } = await import('./allocation');
  const accounts = await prisma.providerAccount.findMany({
    include: {
      generationJobs: {
        where: {
          status: {
            in: [
              JobStatus.PREPARING,
              JobStatus.GENERATING,
              JobStatus.RETRYING,
              JobStatus.IN_QUEUE,
              JobStatus.CHECKING_STATUS,
            ],
          },
        },
        select: { userId: true, id: true },
      },
      assignedUsers: {
        select: {
          id: true,
          name: true,
          email: true,
          lastSeenAt: true,
          providerAssignmentManual: true,
          assignedFlowProjectId: true,
        },
      },
    },
  });

  return accounts.map((acc) => {
    const accountLimit = acc.maxParallelLimit && acc.maxParallelLimit > 0 ? acc.maxParallelLimit : 5;
    // Capacity = sticky login assignments only (not every user who still has a job row on this account)
    const activeUsersCount = acc.assignedUsers.length;
    const activeGenerationsCount = acc.generationJobs.length;
    const availableUserSlots = Math.max(0, accountLimit - activeUsersCount);

    // Load score: accounts with lower user saturation and lower active generations have lower score (better)
    const loadScore = (activeUsersCount / accountLimit) * 100 + activeGenerationsCount * 10;

    const assignedUsers = acc.assignedUsers.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      lastSeenAt: u.lastSeenAt,
      isOnline: isUserOnline(u.lastSeenAt),
      hasActiveJobs: acc.generationJobs.some((j) => j.userId === u.id),
      isManual: u.providerAssignmentManual,
      assignedFlowProjectId: u.assignedFlowProjectId,
    }));

    return {
      id: acc.id,
      label: acc.label,
      accountEmail: acc.accountEmail,
      status: acc.status,
      creditClassification: acc.creditClassification,
      googleCreditsBalance: acc.googleCreditsBalance,
      googleCreditsReserved: acc.googleCreditsReserved,
      activeUsersCount,
      maxUsersLimit: accountLimit,
      activeGenerationsCount,
      availableUserSlots,
      loadScore,
      assignedUsers,
      onlineAssignedCount: assignedUsers.filter((u) => u.isOnline).length,
    };
  });
}

/**
 * Smart Account Allocation:
 * Allocates a Google account respecting each account's configured maxParallelLimit
 * (= max sticky SaaS users / Flow project slots). User concurrent gens are gated
 * separately by the plan's maxParallel (e.g. 4 jobs in the same Flow project).
 */
async function persistAutoAssignment(userId: string, accountId: string) {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { assignedProviderAccountId: true, providerAssignmentManual: true },
  });
  if (existing?.providerAssignmentManual) return;
  const sameAccount = existing?.assignedProviderAccountId === accountId;
  await prisma.user
    .updateMany({
      where: { id: userId, providerAssignmentManual: false },
      data: {
        assignedProviderAccountId: accountId,
        providerAssignmentManual: false,
        ...(sameAccount ? {} : { assignedFlowProjectId: null }),
      },
    })
    .catch(() => null);
}

function accountUserLimit(maxParallelLimit: number | null | undefined): number {
  return maxParallelLimit && maxParallelLimit > 0 ? maxParallelLimit : 5;
}

/** Provider usable for dispatch even if cookies were marked expired (BiB browser still live). */
function isDispatchableAccount(acc: {
  status: ProviderStatus;
  browserStatus: BrowserStatus | null;
}): boolean {
  if (acc.browserStatus === BrowserStatus.READY) return true;
  if (acc.status === ProviderStatus.HEALTHY) return true;
  return false;
}

export async function selectProviderAccountForJob(
  walletType: WalletType,
  modelKey: string,
  requestingUserId: string,
  preferredAccountId?: string | null
) {
  const result = await selectProviderAccountForJobDetailed(
    walletType,
    modelKey,
    requestingUserId,
    preferredAccountId
  );
  return result.account;
}

/** After BiB restarts, DB browserStatus can lag behind live READY — refresh from /health. */
async function syncBrowserStatusFromBibLive() {
  try {
    const { getBibWorkerUrl } = await import('./bib');
    const res = await fetch(`${getBibWorkerUrl()}/health`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return;
    const data = (await res.json().catch(() => null)) as {
      accounts?: { accountId?: string; status?: string; running?: boolean; lastError?: string | null }[];
    } | null;
    const list = Array.isArray(data?.accounts) ? data!.accounts! : [];
    await Promise.all(
      list.map(async (a) => {
        const id = String(a.accountId || '').trim();
        if (!id) return;
        if (a.status === 'READY' || a.running) {
          await prisma.providerAccount
            .update({
              where: { id },
              data: {
                browserStatus: BrowserStatus.READY,
                status: ProviderStatus.HEALTHY,
                bibLastSeenAt: new Date(),
                bibLastError: null,
              },
            })
            .catch(() => 0);
        } else if (a.status === 'NEEDS_LOGIN') {
          await prisma.providerAccount
            .update({
              where: { id },
              data: {
                browserStatus: BrowserStatus.NEEDS_LOGIN,
                bibLastSeenAt: new Date(),
                bibLastError: a.lastError || 'BiB needs Google login',
              },
            })
            .catch(() => 0);
        }
      })
    );
  } catch {
    // BiB unreachable — leave DB as-is
  }
}

export async function selectProviderAccountForJobDetailed(
  walletType: WalletType,
  _modelKey: string,
  requestingUserId: string,
  preferredAccountId?: string | null
): Promise<{ account: any | null; reason?: string }> {
  // Include CREDENTIALS_EXPIRED — BiB READY still generates; cookie flag is often stale.
  let accounts = await prisma.providerAccount.findMany({
    where: {
      OR: [
        { status: ProviderStatus.HEALTHY },
        { status: ProviderStatus.CREDENTIALS_EXPIRED },
        { browserStatus: BrowserStatus.READY },
      ],
    },
    include: {
      generationJobs: {
        where: { status: { in: [JobStatus.PREPARING, JobStatus.GENERATING, JobStatus.RETRYING] } },
        select: { userId: true, id: true },
      },
      assignedUsers: {
        select: { id: true },
      },
    },
  });

  let dispatchable = accounts.filter(isDispatchableAccount);
  let readyAccounts = dispatchable.filter((a) => a.browserStatus === BrowserStatus.READY);
  let poolBase = readyAccounts.length > 0 ? readyAccounts : dispatchable;

  // Stale DB after BiB restart: live browser may already be READY
  if (poolBase.length === 0 || readyAccounts.length === 0) {
    await syncBrowserStatusFromBibLive();
    accounts = await prisma.providerAccount.findMany({
      where: {
        OR: [
          { status: ProviderStatus.HEALTHY },
          { status: ProviderStatus.CREDENTIALS_EXPIRED },
          { browserStatus: BrowserStatus.READY },
        ],
      },
      include: {
        generationJobs: {
          where: { status: { in: [JobStatus.PREPARING, JobStatus.GENERATING, JobStatus.RETRYING] } },
          select: { userId: true, id: true },
        },
        assignedUsers: {
          select: { id: true },
        },
      },
    });
    dispatchable = accounts.filter(isDispatchableAccount);
    readyAccounts = dispatchable.filter((a) => a.browserStatus === BrowserStatus.READY);
    poolBase = readyAccounts.length > 0 ? readyAccounts : dispatchable;
  }

  if (poolBase.length === 0) {
    if (accounts.length === 0) {
      return {
        account: null,
        reason: 'In Queue: No Google provider account available. Admin must add/launch a BiB account.',
      };
    }
    return {
      account: null,
      reason:
        'In Queue: Google provider needs BiB Launch / Login (browser not READY). Not a user-slot limit.',
    };
  }

  const canAcceptUser = (acc: (typeof accounts)[0]) => {
    if (acc.assignedUsers.some((u) => u.id === requestingUserId)) {
      return true;
    }
    const limit = accountUserLimit(acc.maxParallelLimit);
    return acc.assignedUsers.length < limit;
  };

  let targetAccountId = preferredAccountId;
  if (!targetAccountId && requestingUserId) {
    try {
      const userRec = await prisma.user.findUnique({
        where: { id: requestingUserId },
        select: { assignedProviderAccountId: true, providerAssignmentManual: true },
      });
      if (userRec?.assignedProviderAccountId) {
        targetAccountId = userRec.assignedProviderAccountId;
      }
    } catch (lookupErr) {
      console.warn('Failed to query user assigned account:', lookupErr);
    }
  }

  if (targetAccountId) {
    const sticky = poolBase.find((a) => a.id === targetAccountId);
    if (sticky) {
      return { account: sticky };
    }
    // Sticky account is dead / not READY — auto users get reassigned; manual pins stay blocked
    const userRec = requestingUserId
      ? await prisma.user.findUnique({
          where: { id: requestingUserId },
          select: { providerAssignmentManual: true },
        })
      : null;
    if (userRec?.providerAssignmentManual) {
      const pinned = await prisma.providerAccount.findUnique({ where: { id: targetAccountId } });
      if (pinned && isDispatchableAccount(pinned)) {
        return { account: pinned };
      }
      return {
        account: null,
        reason:
          'In Queue: Your pinned Google account is offline (BiB not READY). Launch it in Admin → Accounts.',
      };
    }
    // fall through to pick a new READY account
  }

  const candidateAccounts = poolBase.filter(canAcceptUser);
  if (candidateAccounts.length === 0) {
    const limitHint = accountUserLimit(poolBase[0]?.maxParallelLimit);
    console.warn(`All dispatchable Google accounts are at sticky user capacity (${limitHint}).`);
    return {
      account: null,
      reason: `In Queue: All Google accounts are full (${limitHint} sticky users each). Waiting for a free user slot.`,
    };
  }

  if (walletType === WalletType.PRO) {
    const fundedAccounts = candidateAccounts.filter(
      (acc) =>
        acc.creditClassification === CreditClassification.CREDITS_AVAILABLE &&
        acc.googleCreditsBalance > acc.googleCreditsReserved
    );

    const pool = fundedAccounts.length > 0 ? fundedAccounts : candidateAccounts;

    pool.sort((a, b) => {
      const aScore = a.assignedUsers.length * 2 + a.generationJobs.length;
      const bScore = b.assignedUsers.length * 2 + b.generationJobs.length;
      return aScore - bScore;
    });

    const picked = pool[0];
    if (picked && requestingUserId) {
      await persistAutoAssignment(requestingUserId, picked.id);
    }
    return { account: picked };
  }

  const exhaustedAccounts = candidateAccounts.filter(
    (acc) => acc.creditClassification === CreditClassification.CREDITS_EXHAUSTED
  );

  if (exhaustedAccounts.length > 0) {
    exhaustedAccounts.sort((a, b) => {
      return (
        a.assignedUsers.length + a.generationJobs.length -
        (b.assignedUsers.length + b.generationJobs.length)
      );
    });
    const picked = exhaustedAccounts[0];
    if (picked && requestingUserId) {
      await persistAutoAssignment(requestingUserId, picked.id);
    }
    return { account: picked };
  }

  candidateAccounts.sort((a, b) => {
    return (
      a.assignedUsers.length + a.generationJobs.length -
      (b.assignedUsers.length + b.generationJobs.length)
    );
  });

  const picked = candidateAccounts[0];
  if (picked && requestingUserId) {
    await persistAutoAssignment(requestingUserId, picked.id);
  }
  return { account: picked };
}
