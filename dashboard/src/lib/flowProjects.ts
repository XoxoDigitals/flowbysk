/** Google Flow project pool helpers (shared slots on a ProviderAccount). */

import { JobStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export function flowProjectUrl(projectId: string): string {
  return `https://flow.google.com/project/${projectId}`;
}

export function extractFlowProjectIdFromUrl(input?: string | null): string | null {
  if (!input || !input.trim()) return null;
  const str = input.trim();
  const match = str.match(/project\/([a-zA-Z0-9_-]+)/i);
  if (match?.[1]) return match[1];
  if (/^[a-f0-9-]{36}$/i.test(str)) return str;
  return null;
}

export function listFlowProjectIds(provider: {
  flowProjectIds?: unknown;
  activeProjectId?: string | null;
  projectUrl?: string | null;
}): string[] {
  const fromJson = Array.isArray(provider.flowProjectIds)
    ? (provider.flowProjectIds as string[]).filter(Boolean)
    : [];
  if (fromJson.length) return [...new Set(fromJson.map((id) => String(id)))];
  if (provider.activeProjectId) return [provider.activeProjectId];
  const fromUrl = extractFlowProjectIdFromUrl(provider.projectUrl);
  return fromUrl ? [fromUrl] : [];
}

/** Prefer idle projects; among ties, pick the least currently busy. */
export function pickLeastLoadedFlowProject(
  projectIds: string[],
  busyCounts: Map<string, number> | Record<string, number>
): string | undefined {
  if (!projectIds.length) return undefined;
  const count = (id: string) => {
    const key = id.toLowerCase();
    if (busyCounts instanceof Map) {
      return busyCounts.get(id) || busyCounts.get(key) || 0;
    }
    return busyCounts[id] || busyCounts[key] || 0;
  };
  let best = projectIds[0];
  let bestCount = count(best);
  for (let i = 1; i < projectIds.length; i++) {
    const id = projectIds[i];
    const c = count(id);
    if (c < bestCount) {
      best = id;
      bestCount = c;
    }
  }
  return best;
}

export function flowProjectIdFromJobParameters(parameters: unknown): string | null {
  if (!parameters || typeof parameters !== 'object') return null;
  const p = parameters as Record<string, unknown>;
  const raw = p.flowProjectId || p.flow_project_id || p.project_id;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function normalizeProjectId(id: string, pool: string[]): string {
  const hit = pool.find((p) => p.toLowerCase() === id.toLowerCase());
  return hit || id;
}

/**
 * Choose a Flow project for an upcoming generation.
 * Once a user is pinned (`User.assignedFlowProjectId`), every job for that user
 * on this Google account reuses the same project — never round-robins the pool.
 */
export async function resolveTargetFlowProject(
  provider: {
    id: string;
    flowProjectIds?: unknown;
    activeProjectId?: string | null;
    projectUrl?: string | null;
  },
  opts?: { preferredUserId?: string | null; assignedUserIds?: string[] }
): Promise<string | undefined> {
  const ids = listFlowProjectIds(provider);
  if (!ids.length) return undefined;
  const idSet = new Set(ids.map((id) => id.toLowerCase()));

  const jobs = await prisma.generationJob.findMany({
    where: {
      providerAccountId: provider.id,
      status: {
        in: [
          JobStatus.PREPARING,
          JobStatus.GENERATING,
          JobStatus.RETRYING,
          JobStatus.CHECKING_STATUS,
        ],
      },
    },
    select: { parameters: true },
  });

  const busy = new Map<string, number>();
  for (const j of jobs) {
    const id = flowProjectIdFromJobParameters(j.parameters);
    if (!id) continue;
    const k = id.toLowerCase();
    busy.set(k, (busy.get(k) || 0) + 1);
  }

  if (opts?.preferredUserId) {
    const userId = opts.preferredUserId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { assignedFlowProjectId: true, assignedProviderAccountId: true },
    });

    const pinned = user?.assignedFlowProjectId?.trim();
    if (pinned && idSet.has(pinned.toLowerCase())) {
      // Durable pin: never recompute while still in this account's pool
      return normalizeProjectId(pinned, ids);
    }

    // Prefer last job's flow project if still free on this account
    const lastJob = await prisma.generationJob.findFirst({
      where: { userId, providerAccountId: provider.id },
      orderBy: { createdAt: 'desc' },
      select: { parameters: true },
    });
    const lastProject = flowProjectIdFromJobParameters(lastJob?.parameters);

    const peers = await prisma.user.findMany({
      where: {
        assignedProviderAccountId: provider.id,
        id: { not: userId },
        assignedFlowProjectId: { not: null },
      },
      select: { assignedFlowProjectId: true },
    });
    const taken = new Set(
      peers
        .map((u) => String(u.assignedFlowProjectId || '').toLowerCase())
        .filter(Boolean)
    );

    let chosen: string | undefined;
    if (lastProject && idSet.has(lastProject.toLowerCase()) && !taken.has(lastProject.toLowerCase())) {
      chosen = normalizeProjectId(lastProject, ids);
    } else {
      chosen = ids.find((id) => !taken.has(id.toLowerCase())) || ids[0];
      chosen = normalizeProjectId(chosen, ids);
    }
    if (!chosen) return undefined;

    // Atomic claim: only write if still null / invalid so concurrent jobs don't race
    const claimWhere: any = {
      id: userId,
      OR: [{ assignedFlowProjectId: null }],
    };
    if (pinned && !idSet.has(pinned.toLowerCase())) {
      claimWhere.OR.push({ assignedFlowProjectId: pinned });
    }
    const updated = await prisma.user.updateMany({
      where: claimWhere,
      data: { assignedFlowProjectId: chosen },
    });

    if (updated.count === 0) {
      const again = await prisma.user.findUnique({
        where: { id: userId },
        select: { assignedFlowProjectId: true },
      });
      const won = again?.assignedFlowProjectId?.trim();
      if (won && idSet.has(won.toLowerCase())) {
        return normalizeProjectId(won, ids);
      }
    }

    return chosen;
  }

  return pickLeastLoadedFlowProject(ids, busy);
}

/** Stable 1:1 mapping of assigned users onto Flow project slots (display / first-pin only). */
export function stickyProjectForUser(
  userId: string,
  projectIds: string[],
  assignedUserIds: string[]
): string | undefined {
  if (!projectIds.length || !userId) return undefined;
  const sortedUsers = [...assignedUserIds].sort();
  const idx = sortedUsers.indexOf(userId);
  if (idx < 0) return undefined;
  return projectIds[idx % projectIds.length];
}

export function buildStickyAssignments(
  projectIds: string[],
  users: FlowProjectUsageUser[]
): Map<string, FlowProjectUsageUser> {
  const map = new Map<string, FlowProjectUsageUser>();
  if (!projectIds.length || !users.length) return map;

  // Prefer persisted pins so admin UI matches runtime routing
  const unpinned: FlowProjectUsageUser[] = [];
  for (const u of users) {
    const pin = (u.assignedFlowProjectId || '').trim();
    if (pin) {
      const key = pin.toLowerCase();
      if (projectIds.some((id) => id.toLowerCase() === key) && !map.has(key)) {
        map.set(key, u);
        continue;
      }
    }
    unpinned.push(u);
  }

  const sorted = [...unpinned].sort((a, b) => a.id.localeCompare(b.id));
  let slot = 0;
  for (const u of sorted) {
    while (slot < projectIds.length && map.has(projectIds[slot].toLowerCase())) {
      slot++;
    }
    if (slot >= projectIds.length) break;
    map.set(projectIds[slot].toLowerCase(), u);
    slot++;
  }
  return map;
}

export type FlowProjectUsageUser = {
  id: string;
  name: string | null;
  email: string;
  assignedFlowProjectId?: string | null;
};

export type FlowProjectRow = {
  id: string;
  url: string;
  assignedUser: FlowProjectUsageUser | null;
  usedBy: FlowProjectUsageUser[];
};
