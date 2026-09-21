import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { requireAccountsPageAccess } from '@/lib/accountsAccess';
import { prisma } from '@/lib/prisma';
import { ProviderStatus, CreditClassification, JobStatus } from '@prisma/client';
import { getAccountsAllocationStats } from '@/lib/routing';
import { releaseIdleOfflineAllocations } from '@/lib/allocation';
import {
  flowProjectIdFromJobParameters,
  flowProjectUrl,
  listFlowProjectIds,
  buildStickyAssignments,
  type FlowProjectRow,
} from '@/lib/flowProjects';
import {
  ensureUniqueProxyForAccount,
  getProxyUrlForAccount,
  maskProxyUrl,
  readEgressProxyMirror,
} from '@/lib/egressProxy';
import { readDataImpulseConfig } from '@/lib/dataimpulse';

function extractProjectDetails(input?: string | null): { projectId: string; projectUrl: string } {
  if (!input || !input.trim()) return { projectId: '', projectUrl: '' };
  const str = input.trim();
  const match = str.match(/project\/([a-zA-Z0-9_-]+)/);
  const id = match ? match[1] : (str.startsWith('http') ? str.split('/').filter(Boolean).pop() || str : str);
  const url = str.startsWith('http') ? str : `https://flow.google.com/project/${id}`;
  return { projectId: id, projectUrl: url };
}

export async function GET(req: Request) {
  try {
    const session = await requireAdmin(req);
    await requireAccountsPageAccess(session);

    // Opportunistic cleanup of offline idle allocations
    releaseIdleOfflineAllocations().catch(() => 0);

    const stats = await getAccountsAllocationStats();

    // Fetch raw records to include cookies preview and creation time
    const accounts = await prisma.providerAccount.findMany({
      orderBy: { createdAt: 'desc' },
    });

    const statsMap = new Map(stats.map((s) => [s.id, s]));

    // Live Flow-project occupancy: which SaaS user is generating on each slot
    const activeJobs = await prisma.generationJob.findMany({
      where: {
        providerAccountId: { in: accounts.map((a) => a.id) },
        status: {
          in: [
            JobStatus.IN_QUEUE,
            JobStatus.PREPARING,
            JobStatus.GENERATING,
            JobStatus.RETRYING,
            JobStatus.CHECKING_STATUS,
          ],
        },
      },
      select: {
        providerAccountId: true,
        parameters: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    const usageByAccount = new Map<string, Map<string, FlowProjectRow['usedBy']>>();
    for (const job of activeJobs) {
      if (!job.providerAccountId) continue;
      const flowId = flowProjectIdFromJobParameters(job.parameters);
      if (!flowId) continue;
      const key = flowId.toLowerCase();
      if (!usageByAccount.has(job.providerAccountId)) {
        usageByAccount.set(job.providerAccountId, new Map());
      }
      const projMap = usageByAccount.get(job.providerAccountId)!;
      const list = projMap.get(key) || [];
      if (!list.some((u) => u.id === job.user.id)) {
        list.push({ id: job.user.id, name: job.user.name, email: job.user.email });
      }
      projMap.set(key, list);
    }

    const mirror = readEgressProxyMirror();
    const sanitized = accounts.map((acc) => {
      const s = statsMap.get(acc.id);
      const supportedObj = acc.supportedModels as any;
      const planName = acc.planTier || supportedObj?.planName ||
        (acc.label.toLowerCase().includes('ultra') ? 'Google AI Ultra' :
         acc.label.toLowerCase().includes('pro') ? 'Google AI Pro' :
         acc.label.toLowerCase().includes('tier 1') ? 'Google AI Tier 1' : 'Google AI Ultra');

      const maxLimit = acc.maxParallelLimit && acc.maxParallelLimit > 0 ? acc.maxParallelLimit : 5;
      const projectIds = listFlowProjectIds(acc);
      const usageMap = usageByAccount.get(acc.id) || new Map();
      const sticky = buildStickyAssignments(
        projectIds,
        (s?.assignedUsers || []).map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          assignedFlowProjectId: (u as any).assignedFlowProjectId || null,
        }))
      );
      const flowProjects: FlowProjectRow[] = projectIds.map((id) => ({
        id,
        url: flowProjectUrl(id),
        assignedUser: sticky.get(id.toLowerCase()) || null,
        usedBy: usageMap.get(id.toLowerCase()) || [],
      }));

      // Sticky egress: ensure assignment exists for accounts with a BiB profile / live status
      let egressUrl = getProxyUrlForAccount(acc.id);
      if (
        !egressUrl &&
        (acc.profileDir ||
          acc.browserStatus === 'READY' ||
          acc.browserStatus === 'NEEDS_LOGIN' ||
          acc.browserStatus === 'STARTING')
      ) {
        egressUrl = ensureUniqueProxyForAccount(acc.id).url;
      }
      const proxiesNow = egressUrl ? readEgressProxyMirror().proxies : mirror.proxies;
      const egressEntry = egressUrl
        ? proxiesNow.find(
            (p) =>
              p.enabled !== false &&
              (p.url === egressUrl || p.id === `di-${acc.id}`)
          )
        : null;

      let diPort: number | null = null;
      let diLastRotatedAt: string | null = null;
      let diCountry: string | null = null;
      try {
        const meta = readDataImpulseConfig().accountMeta[acc.id];
        if (meta) {
          diPort = meta.port ?? null;
          diLastRotatedAt = meta.updatedAt || null;
          diCountry = meta.country ? meta.country.toUpperCase() : null;
        }
      } catch {
        /* ignore */
      }

      return {
        id: acc.id,
        label: acc.label,
        accountEmail: acc.accountEmail,
        status: acc.status,
        planName,
        planTier: planName,
        projectUrl: acc.projectUrl || '',
        activeProjectId: acc.activeProjectId || '',
        creditClassification: acc.creditClassification,
        googleCreditsBalance: acc.googleCreditsBalance,
        googleCreditsReserved: acc.googleCreditsReserved,
        maxUsersLimit: maxLimit,
        maxParallelLimit: maxLimit,
        activeUsersCount: s?.activeUsersCount || 0,
        onlineAssignedCount: s?.onlineAssignedCount || 0,
        availableUserSlots: Math.max(0, maxLimit - (s?.activeUsersCount || 0)),
        activeJobsCount: s?.activeGenerationsCount || 0,
        loadScore: s?.loadScore || 0,
        assignedUsers: s?.assignedUsers || [],
        supportedModels: acc.supportedModels,
        lastHealthCheck: acc.lastHealthCheck,
        hasCookies: !!acc.cookies,
        cookiesPreview: acc.cookies ? `${acc.cookies.substring(0, 30)}...` : null,
        cookieExpiresAt: acc.cookieExpiresAt,
        createdAt: acc.createdAt,
        browserStatus: acc.browserStatus,
        profileDir: acc.profileDir,
        flowProjectIds: acc.flowProjectIds,
        flowProjects,
        bibLastSeenAt: acc.bibLastSeenAt,
        bibLastError: acc.bibLastError,
        egressProxyUrl: egressUrl,
        egressProxyMasked: egressUrl ? maskProxyUrl(egressUrl) : null,
        egressIp: egressEntry?.ip ?? null,
        egressCountry: egressEntry?.country ?? diCountry,
        egressProxyId: egressEntry?.id ?? null,
        egressPort: diPort,
        egressLastRotatedAt: diLastRotatedAt,
      };
    });

    return NextResponse.json({ success: true, accounts: sanitized });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    await requireAccountsPageAccess(admin);
    const body = await req.json();
    const {
      label,
      accountEmail,
      cookies,
      maxParallelLimit,
      planTier,
      projectUrl,
    } = body;

    // BiB-only: reject cookie paste
    if (cookies && cookies.trim()) {
      return NextResponse.json(
        { error: 'Cookie paste is disabled. Use BiB (Browser-in-Browser) login to connect accounts.' },
        { status: 400 }
      );
    }

    // BiB path: create shell account without cookies; Launch + login later
    const finalEmail = (accountEmail && accountEmail.trim()) || 'pending@google.com';
    const finalPlan = (planTier && planTier.trim()) || 'Google AI Ultra';
    const finalLabel = (label && label.trim()) || `${finalPlan} (BiB)`;
    const limit =
      typeof maxParallelLimit === 'number' && maxParallelLimit > 0 ? maxParallelLimit : 5;

    // Resolve optional single seed project URL
    const projDetails = projectUrl ? extractProjectDetails(projectUrl) : { projectId: '', projectUrl: '' };

    const account = await prisma.providerAccount.create({
      data: {
        label: finalLabel,
        accountEmail: finalEmail,
        cookies: '',
        status: ProviderStatus.UNAVAILABLE,
        creditClassification: CreditClassification.UNKNOWN,
        googleCreditsBalance: 0,
        maxParallelLimit: limit,
        planTier: finalPlan,
        browserStatus: 'STOPPED' as any,
        ...(projDetails.projectId ? {
          activeProjectId: projDetails.projectId,
          projectUrl: projDetails.projectUrl,
        } : {}),
      },
    });

    await prisma.adminAuditLog.create({
      data: {
        adminId: admin.userId,
        action: 'PROVIDER_ACCOUNT_CREATED',
        targetType: 'PROVIDER_ACCOUNT',
        targetId: account.id,
        details: { label: finalLabel, accountEmail: finalEmail, bib: true },
      },
    });

    return NextResponse.json({ success: true, account, bib: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Operation failed' },
      { status: 400 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const admin = await requireAdmin(req);
    await requireAccountsPageAccess(admin);
    const body = await req.json();
    const { id, cookies, status, action, planTier, projectUrl, maxParallelLimit } = body;

    if (!id) {
      return NextResponse.json({ error: 'Account ID required' }, { status: 400 });
    }

    // BiB-only: reject cookie paste updates
    if (cookies !== undefined && cookies && cookies.trim()) {
      return NextResponse.json(
        { error: 'Cookie paste updates are disabled. Use BiB login — credentials are synced automatically.' },
        { status: 400 }
      );
    }

    const existing = await prisma.providerAccount.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const updateData: any = {};

    // Live Project Creation Action on Google Flow (via BiB or fallback)
    if (action === 'create_project') {
      try {
        let newPid = '';
        let newPUrl = '';

        // Try BiB first for project creation
        try {
          const { bibFetch } = await import('@/lib/bib');
          const bibRes = await bibFetch(`/accounts/${encodeURIComponent(id)}/ensure-projects`, {
            method: 'POST',
            body: JSON.stringify({ maxSlots: existing.maxParallelLimit || 5 }),
          });
          if (bibRes.ok) {
            const bibData = await bibRes.json().catch(() => ({}));
            const ids: string[] = Array.isArray(bibData.projectIds) ? bibData.projectIds : [];
            if (ids.length > 0) {
              newPid = ids[0];
              newPUrl = `https://flow.google.com/project/${newPid}`;
            }
          }
        } catch (bibErr: any) {
          console.warn('BiB project creation error:', bibErr.message);
        }

        // If BiB didn't return an id, generate a placeholder UUID
        if (!newPid) {
          const crypto = await import('crypto');
          newPid = crypto.randomUUID();
          newPUrl = `https://flow.google.com/project/${newPid}`;
        }

        const updated = await prisma.providerAccount.update({
          where: { id },
          data: {
            activeProjectId: newPid,
            projectUrl: newPUrl,
          },
        });

        await prisma.adminAuditLog.create({
          data: {
            adminId: admin.userId,
            action: 'PROVIDER_PROJECT_CREATED',
            targetType: 'PROVIDER_ACCOUNT',
            targetId: id,
            details: { projectId: newPid, projectUrl: newPUrl },
          },
        });

        return NextResponse.json({
          success: true,
          message: `Project created and assigned: ${newPUrl}`,
          account: updated,
        });
      } catch (err: any) {
        return NextResponse.json({ error: `Failed to create Google Flow project: ${err.message}` }, { status: 500 });
      }
    }

    // Live Detection / Refresh Action — BiB status only, no labs cookie probe
    if (action === 'refresh' || action === 'detect') {
      let bibReady = existing.browserStatus === 'READY';
      try {
        const { bibAccountStatus } = await import('@/lib/bib');
        const live = await bibAccountStatus(id);
        if (live?.status === 'READY' || live?.running) {
          bibReady = true;
          updateData.browserStatus = 'READY' as any;
          if (Array.isArray(live.projectIds) && live.projectIds.length) {
            updateData.flowProjectIds = live.projectIds;
          }
          if (live.email) updateData.accountEmail = live.email;
          updateData.bibLastError = null;
          updateData.bibLastSeenAt = new Date();
          // BiB READY → account is healthy
          updateData.status = ProviderStatus.HEALTHY;
          updateData.lastHealthCheck = new Date();
        } else if (live?.status === 'NEEDS_LOGIN') {
          updateData.browserStatus = 'NEEDS_LOGIN' as any;
          updateData.bibLastError = live.lastError || 'BiB needs Google login';
          updateData.bibLastSeenAt = new Date();
        }
      } catch {
        /* BiB unreachable */
      }

      if (!bibReady) {
        // Keep existing status unchanged if BiB is not reachable
        updateData.status = existing.status;
        updateData.lastHealthCheck = new Date();
      }

      if (planTier && planTier.trim()) {
        updateData.planTier = planTier.trim();
      }

      const updated = await prisma.providerAccount.update({
        where: { id },
        data: updateData,
      });

      return NextResponse.json({
        success: true,
        message: bibReady
          ? `Account healthy via BiB (READY)`
          : `BiB not READY — status unchanged (${existing.status})`,
        account: updated,
        bibReady,
      });
    }

    if (projectUrl !== undefined) {
      const p = extractProjectDetails(projectUrl);
      updateData.projectUrl = p.projectUrl || null;
      updateData.activeProjectId = p.projectId || null;
    }

    if (planTier !== undefined && planTier.trim()) {
      updateData.planTier = planTier.trim();
    }

    if (maxParallelLimit !== undefined) {
      const limit = Number(maxParallelLimit);
      if (!isNaN(limit) && limit > 0) {
        updateData.maxParallelLimit = limit;
      }
    }

    if (status) {
      updateData.status = status;
    }

    const updated = await prisma.providerAccount.update({
      where: { id },
      data: updateData,
    });

    await prisma.adminAuditLog.create({
      data: {
        adminId: admin.userId,
        action: 'PROVIDER_ACCOUNT_UPDATED',
        targetType: 'PROVIDER_ACCOUNT',
        targetId: id,
        details: { fieldsUpdated: Object.keys(updateData) },
      },
    });

    return NextResponse.json({ success: true, account: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to update account' }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const admin = await requireAdmin(req);
    await requireAccountsPageAccess(admin);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Account ID required' }, { status: 400 });
    }

    // Unlink assigned users (manual pins cleared when account deleted)
    await prisma.user.updateMany({
      where: { assignedProviderAccountId: id },
      data: { assignedProviderAccountId: null, assignedFlowProjectId: null, providerAssignmentManual: false },
    });

    // Delete provider bindings
    await prisma.projectProviderBinding.deleteMany({
      where: { providerAccountId: id },
    });

    // Delete account
    await prisma.providerAccount.delete({
      where: { id },
    });

    try {
      const { pruneOrphanDataImpulseAssignments } = await import('@/lib/dataimpulse');
      const live = await prisma.providerAccount.findMany({ select: { id: true } });
      pruneOrphanDataImpulseAssignments(live.map((a) => a.id));
    } catch (e) {
      console.warn('[accounts] prune DataImpulse orphans after delete:', e);
    }

    await prisma.adminAuditLog.create({
      data: {
        adminId: admin.userId,
        action: 'PROVIDER_ACCOUNT_DELETED',
        targetType: 'PROVIDER_ACCOUNT',
        targetId: id,
      },
    });

    return NextResponse.json({ success: true, message: 'Provider account deleted successfully' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to delete account' }, { status: 400 });
  }
}
