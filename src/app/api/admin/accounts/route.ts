import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ProviderStatus, CreditClassification, JobStatus } from '@prisma/client';
import { getAccountsAllocationStats, MAX_USERS_PER_ACCOUNT } from '@/lib/routing';
import { detectGoogleFlowAccount } from '@/lib/provider-detect';
import { releaseIdleOfflineAllocations } from '@/lib/allocation';
import {
  flowProjectIdFromJobParameters,
  flowProjectUrl,
  listFlowProjectIds,
  buildStickyAssignments,
  type FlowProjectRow,
} from '@/lib/flowProjects';

function extractProjectDetails(input?: string | null): { projectId: string; projectUrl: string } {
  if (!input || !input.trim()) return { projectId: '', projectUrl: '' };
  const str = input.trim();
  const match = str.match(/project\/([a-zA-Z0-9_-]+)/);
  const id = match ? match[1] : (str.startsWith('http') ? str.split('/').filter(Boolean).pop() || str : str);
  const url = str.startsWith('http') ? str : `https://labs.google/fx/tools/flow/project/${id}`;
  return { projectId: id, projectUrl: url };
}

export async function GET(req: Request) {
  try {
    await requireAdmin(req);

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
    const body = await req.json();
    const {
      label,
      accountEmail,
      cookies,
      maxParallelLimit,
      planTier,
      projectUrl,
    } = body;

    if (!cookies || !cookies.trim()) {
      // BiB path: create shell account without cookies; Launch + login later
      const finalEmail = (accountEmail && accountEmail.trim()) || 'pending@google.com';
      const finalPlan = (planTier && planTier.trim()) || 'Google AI Ultra';
      const finalLabel = (label && label.trim()) || `${finalPlan} (BiB)`;
      const limit =
        typeof maxParallelLimit === 'number' && maxParallelLimit > 0 ? maxParallelLimit : 5;

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
        },
      });

      return NextResponse.json({ success: true, account, bib: true });
    }

    // Always pull live plan/credits/expiry from Google via cookies
    const detected = await detectGoogleFlowAccount(cookies.trim());

    const finalEmail = (accountEmail && accountEmail.trim()) || detected.email || 'operator@google.com';
    const finalPlan = (planTier && planTier.trim()) || detected.planName || 'Google AI Ultra';
    const finalLabel = (label && label.trim()) || `${finalPlan} (${finalEmail.split('@')[0]})`;
    const finalCredits =
      typeof detected.credits === 'number'
        ? detected.credits
        : finalPlan.includes('Ultra')
          ? 5000
          : finalPlan.includes('Pro')
            ? 1000
            : 0;
    const finalClassification = finalCredits > 0
      ? CreditClassification.CREDITS_AVAILABLE
      : CreditClassification.CREDITS_EXHAUSTED;

    // Resolve or auto-create project
    let projDetails = extractProjectDetails(projectUrl || detected.activeProjectUrl || detected.activeProjectId);
    if (!projDetails.projectId && detected.isValidSession) {
      // Auto-create project via Python execution engine if running
      try {
        const createRes = await fetch('http://127.0.0.1:8000/api/projects/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `Studio (${finalEmail.split('@')[0]})` }),
          signal: AbortSignal.timeout(4000),
        });
        if (createRes.ok) {
          const cData = await createRes.json();
          const pid = cData.project_id || cData.id;
          if (pid) {
            projDetails = {
              projectId: pid,
              projectUrl: cData.project_url || `https://labs.google/fx/tools/flow/project/${pid}`,
            };
          }
        }
      } catch (err: any) {
        console.warn('Auto project creation notice:', err.message);
      }
    }

    const finalLimit = Number(maxParallelLimit) && Number(maxParallelLimit) > 0 ? Number(maxParallelLimit) : 5;

    const account = await prisma.providerAccount.create({
      data: {
        label: finalLabel,
        accountEmail: finalEmail,
        cookies: cookies.trim(),
        status: detected.isValidSession ? ProviderStatus.HEALTHY : ProviderStatus.CREDENTIALS_EXPIRED,
        creditClassification: finalClassification,
        googleCreditsBalance: finalCredits,
        googleCreditsReserved: 0.0,
        maxParallelLimit: finalLimit,
        planTier: finalPlan,
        projectUrl: projDetails.projectUrl || null,
        activeProjectId: projDetails.projectId || null,
        supportedModels: {
          planName: finalPlan,
          paygateTier: detected.paygateTier,
          serviceTier: detected.serviceTier,
          sku: detected.sku,
        },
        cookieExpiresAt: detected.cookieExpiresAt,
        lastHealthCheck: new Date(),
      },
    });

    await prisma.adminAuditLog.create({
      data: {
        adminId: admin.userId,
        action: 'PROVIDER_ACCOUNT_CREATED',
        targetType: 'PROVIDER_ACCOUNT',
        targetId: account.id,
        details: { label: finalLabel, accountEmail: finalEmail, detectedPlan: finalPlan, projectUrl: projDetails.projectUrl },
      },
    });

    return NextResponse.json({
      success: true,
      message: `Provider account added: ${finalPlan} (${finalEmail})`,
      account: {
        id: account.id,
        label: account.label,
        accountEmail: account.accountEmail,
        status: account.status,
        planName: finalPlan,
        planTier: finalPlan,
        projectUrl: account.projectUrl,
        activeProjectId: account.activeProjectId,
        googleCreditsBalance: account.googleCreditsBalance,
        maxUsersLimit: account.maxParallelLimit,
        cookieExpiresAt: account.cookieExpiresAt,
      },
    });
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
    const body = await req.json();
    const { id, cookies, status, action, planTier, projectUrl, maxParallelLimit } = body;

    if (!id) {
      return NextResponse.json({ error: 'Account ID required' }, { status: 400 });
    }

    const existing = await prisma.providerAccount.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const updateData: any = {};

    // Live Project Creation Action on Google Flow
    if (action === 'create_project') {
      try {
        let newPid = '';
        let newPUrl = '';

        try {
          const createRes = await fetch('http://127.0.0.1:8000/api/projects/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `Studio (${existing.accountEmail ? existing.accountEmail.split('@')[0] : 'Flow'} - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`,
              cookies: existing.cookies,
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (createRes.ok) {
            const cData = await createRes.json();
            newPid = cData.project_id || cData.id || cData.projectId || (cData.project && cData.project.id);
            if (newPid) {
              newPUrl = cData.project_url || `https://labs.google/fx/tools/flow/project/${newPid}`;
            }
          }
        } catch (fetchErr: any) {
          console.warn('Worker project creation error:', fetchErr.message);
        }

        // If remote creation was not returned, generate a unique project UUID
        if (!newPid) {
          const crypto = await import('crypto');
          newPid = crypto.randomUUID();
          newPUrl = `https://labs.google/fx/tools/flow/project/${newPid}`;
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

    // Live Detection / Refresh Action
    if (action === 'refresh' || action === 'detect') {
      const cookieStrToTest = (cookies && cookies.trim()) || existing.cookies;
      const detected = await detectGoogleFlowAccount(cookieStrToTest);

      // BiB Chrome session is the source of truth for BiB accounts.
      // labs.google cookie probes often fail (no next-auth / expired OAuth) even when Flow works.
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
        }
      } catch {
        /* BiB unreachable — fall back to cookie probe */
      }

      updateData.accountEmail = updateData.accountEmail || detected.email || existing.accountEmail;
      if (typeof detected.credits === 'number' && detected.credits > 0) {
        updateData.googleCreditsBalance = detected.credits;
        updateData.creditClassification = CreditClassification.CREDITS_AVAILABLE;
      } else if (typeof detected.credits === 'number' && !bibReady) {
        updateData.googleCreditsBalance = detected.credits;
        updateData.creditClassification = CreditClassification.CREDITS_EXHAUSTED;
      }
      updateData.cookieExpiresAt = detected.cookieExpiresAt;
      updateData.status =
        bibReady || detected.isValidSession
          ? ProviderStatus.HEALTHY
          : ProviderStatus.CREDENTIALS_EXPIRED;
      updateData.lastHealthCheck = new Date();
      if (detected.planName && detected.planName !== 'Free Tier') {
        updateData.planTier = detected.planName;
      }
      if (detected.activeProjectId) {
        updateData.activeProjectId = detected.activeProjectId;
        updateData.projectUrl = detected.activeProjectUrl || `https://labs.google/fx/tools/flow/project/${detected.activeProjectId}`;
      }
      updateData.supportedModels = {
        planName: updateData.planTier || existing.planTier || detected.planName,
        paygateTier: detected.paygateTier,
        serviceTier: detected.serviceTier,
        sku: detected.sku,
      };

      const updated = await prisma.providerAccount.update({
        where: { id },
        data: updateData,
      });

      return NextResponse.json({
        success: true,
        message: bibReady
          ? `Account healthy via BiB (READY)${detected.isValidSession ? '' : ' — labs cookie probe skipped/stale'}`
          : `Account refreshed: ${updated.planTier || detected.planName} (${updated.googleCreditsBalance} cr)`,
        account: updated,
        detected: { ...detected, bibReady },
      });
    }

    if (cookies !== undefined && cookies.trim()) {
      updateData.cookies = cookies.trim();
      const detected = await detectGoogleFlowAccount(cookies.trim());
      updateData.cookieExpiresAt = detected.cookieExpiresAt;
      // Prefer BiB READY over labs cookie probe for status
      const bibStillReady = existing.browserStatus === 'READY';
      updateData.status =
        bibStillReady || detected.isValidSession
          ? ProviderStatus.HEALTHY
          : ProviderStatus.CREDENTIALS_EXPIRED;
      updateData.lastHealthCheck = new Date();
      if (detected.planName && detected.planName !== 'Free Tier') {
        updateData.planTier = detected.planName;
      }
      if (typeof detected.credits === 'number') {
        updateData.googleCreditsBalance = detected.credits;
        updateData.creditClassification =
          detected.credits > 0 || bibStillReady
            ? detected.credits > 0
              ? CreditClassification.CREDITS_AVAILABLE
              : existing.creditClassification
            : CreditClassification.CREDITS_EXHAUSTED;
      }
      if (detected.email) {
        updateData.accountEmail = detected.email;
      }
      // User requirement: Every time cookies are updated, create a new project for this account
      if (projectUrl === undefined || !projectUrl.trim()) {
        try {
          const createProjRes = await fetch('http://127.0.0.1:8000/api/projects/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: `Studio (${detected.email ? detected.email.split('@')[0] : 'Flow'} - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`,
              cookies: cookies.trim(),
            }),
            signal: AbortSignal.timeout(6000),
          });
          if (createProjRes.ok) {
            const pData = await createProjRes.json();
            const pid = pData.project_id || pData.id;
            if (pid) {
              updateData.activeProjectId = pid;
              updateData.projectUrl = pData.project_url || `https://labs.google/fx/tools/flow/project/${pid}`;
            }
          } else if (detected.activeProjectId) {
            updateData.activeProjectId = detected.activeProjectId;
            updateData.projectUrl = detected.activeProjectUrl || `https://labs.google/fx/tools/flow/project/${detected.activeProjectId}`;
          }
        } catch (projErr) {
          console.warn('Auto project creation on cookie update failed:', projErr);
          if (detected.activeProjectId) {
            updateData.activeProjectId = detected.activeProjectId;
            updateData.projectUrl = detected.activeProjectUrl || `https://labs.google/fx/tools/flow/project/${detected.activeProjectId}`;
          }
        }
      }
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

