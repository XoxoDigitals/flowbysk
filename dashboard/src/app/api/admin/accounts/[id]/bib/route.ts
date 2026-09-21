import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { canAccessProviderAccounts } from '@/lib/accountsAccess';
import { prisma } from '@/lib/prisma';
import { BrowserStatus, ProviderStatus, UserRole } from '@prisma/client';
import {
  bibDisconnectAccount,
  bibEnsureProjects,
  bibScrapeProjects,
  bibLaunchAccount,
  bibAccountStatus,
  bibNavigate,
  bibViewerUrl,
  getBibWorkerUrl,
} from '@/lib/bib';
import path from 'path';

async function requireAccountsAdmin(req: Request) {
  const session = await getOrCreateStudioUser(req);
  if (session.role !== UserRole.ADMIN && session.role !== UserRole.SUPER_ADMIN) {
    return null;
  }
  if (!(await canAccessProviderAccounts(session))) return null;
  return session;
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  if (!(await requireAccountsAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const account = await prisma.providerAccount.findUnique({ where: { id } });
  if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let live: Record<string, unknown> = {};
  try {
    live = await bibAccountStatus(id);
  } catch (e: any) {
    live = { error: e.message || 'BiB unreachable' };
  }

  return NextResponse.json({
    account: {
      id: account.id,
      label: account.label,
      browserStatus: account.browserStatus,
      flowProjectIds: account.flowProjectIds,
      maxParallelLimit: account.maxParallelLimit,
      profileDir: account.profileDir,
      status: account.status,
    },
    live,
    viewerUrl: bibViewerUrl(id),
    bibWorkerUrl: getBibWorkerUrl(),
  });
}

export async function POST(req: Request, ctx: Ctx) {
  if (!(await requireAccountsAdmin(req))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const account = await prisma.providerAccount.findUnique({ where: { id } });
  if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '').toLowerCase();

  try {
    if (action === 'launch') {
      await prisma.providerAccount.update({
        where: { id },
        data: {
          browserStatus: BrowserStatus.STARTING,
          profileDir:
            account.profileDir ||
            path.join(process.cwd(), 'data', 'bib-profiles', id),
        },
      });

      const live = await bibLaunchAccount(id, {
        maxSlots: account.maxParallelLimit,
        projectIds: Array.isArray(account.flowProjectIds)
          ? (account.flowProjectIds as string[])
          : undefined,
        profileDir: account.profileDir,
      });

      const browserStatus =
        live.status === 'READY'
          ? BrowserStatus.READY
          : live.status === 'NEEDS_LOGIN'
            ? BrowserStatus.NEEDS_LOGIN
            : BrowserStatus.STARTING;

      const updated = await prisma.providerAccount.update({
        where: { id },
        data: {
          browserStatus,
          bibLastSeenAt: new Date(),
          bibLastError: null,
          status:
            browserStatus === BrowserStatus.READY
              ? ProviderStatus.HEALTHY
              : account.status,
          accountEmail: live.email || account.accountEmail,
        },
      });

      // Auto-ensure project slots when already READY after launch (returning session)
      let projectsLive = null;
      if (browserStatus === BrowserStatus.READY) {
        try {
          projectsLive = await bibEnsureProjects(id, account.maxParallelLimit);
          await prisma.providerAccount.update({
            where: { id },
            data: {
              flowProjectIds: projectsLive.projectIds || [],
              activeProjectId: (projectsLive.projectIds || [])[0] || undefined,
              projectUrl: (projectsLive.projectIds || [])[0]
                ? `https://flow.google.com/project/${projectsLive.projectIds[0]}`
                : undefined,
            },
          });
        } catch (e: any) {
          console.warn('ensure-projects after launch:', e.message);
        }
      }

      return NextResponse.json({
        success: true,
        action: 'launch',
        account: await prisma.providerAccount.findUnique({ where: { id } }),
        live: projectsLive || live,
        viewerUrl: bibViewerUrl(id),
      });
    }

    if (action === 'disconnect') {
      await bibDisconnectAccount(id, !!body.clearProfile);
      const updated = await prisma.providerAccount.update({
        where: { id },
        data: {
          browserStatus: BrowserStatus.STOPPED,
          bibLastSeenAt: new Date(),
        },
      });
      return NextResponse.json({ success: true, action: 'disconnect', account: updated });
    }

    if (action === 'ensure_projects' || action === 'scrape_projects') {
      const live =
        action === 'scrape_projects'
          ? await bibScrapeProjects(id)
          : await bibEnsureProjects(id, account.maxParallelLimit);
      const projectIds = Array.isArray(live.projectIds) ? live.projectIds : [];
      const updated = await prisma.providerAccount.update({
        where: { id },
        data: {
          flowProjectIds: projectIds,
          activeProjectId: projectIds[0] || account.activeProjectId,
          projectUrl: projectIds[0]
            ? `https://flow.google.com/project/${projectIds[0]}`
            : account.projectUrl,
          browserStatus:
            live.status === 'READY' || projectIds.length > 0
              ? BrowserStatus.READY
              : account.browserStatus,
          bibLastSeenAt: new Date(),
          bibLastError: null,
          status: ProviderStatus.HEALTHY,
        },
      });
      return NextResponse.json({ success: true, action, account: updated, live });
    }

    if (action === 'sync_status') {
      const live = await bibAccountStatus(id);
      const browserStatus =
        live.status === 'READY'
          ? BrowserStatus.READY
          : live.status === 'NEEDS_LOGIN'
            ? BrowserStatus.NEEDS_LOGIN
            : live.status === 'STOPPED'
              ? BrowserStatus.STOPPED
              : live.status === 'ERROR'
                ? BrowserStatus.ERROR
                : account.browserStatus;

      const updated = await prisma.providerAccount.update({
        where: { id },
        data: {
          browserStatus,
          bibLastSeenAt: new Date(),
          accountEmail: live.email || account.accountEmail,
          flowProjectIds: Array.isArray(live.projectIds)
            ? live.projectIds
            : account.flowProjectIds,
          status:
            browserStatus === BrowserStatus.READY
              ? ProviderStatus.HEALTHY
              : browserStatus === BrowserStatus.NEEDS_LOGIN
                ? ProviderStatus.CREDENTIALS_EXPIRED
                : account.status,
        },
      });

      if (browserStatus === BrowserStatus.READY && (!Array.isArray(account.flowProjectIds) || !(account.flowProjectIds as string[]).length)) {
        try {
          const projectsLive = await bibEnsureProjects(id, account.maxParallelLimit);
          await prisma.providerAccount.update({
            where: { id },
            data: {
              flowProjectIds: projectsLive.projectIds || [],
              activeProjectId: (projectsLive.projectIds || [])[0] || undefined,
              projectUrl: (projectsLive.projectIds || [])[0]
                ? `https://flow.google.com/project/${projectsLive.projectIds[0]}`
                : undefined,
              status: ProviderStatus.HEALTHY,
            },
          });
        } catch (e: any) {
          console.warn('ensure-projects after sync:', e.message);
        }
      }

      return NextResponse.json({
        success: true,
        action: 'sync_status',
        account: await prisma.providerAccount.findUnique({ where: { id } }),
        live,
        viewerUrl: bibViewerUrl(id),
      });
    }

    if (action === 'open_project' || action === 'navigate') {
      const projectId = String(body.projectId || '')
        .trim()
        .replace(/^.*\/project\//, '')
        .split(/[?#]/)[0];
      const projectUrl = String(body.url || '').trim();
      const targetUrl =
        projectUrl ||
        (projectId ? `https://flow.google.com/project/${projectId}` : '');
      if (!targetUrl || !targetUrl.includes('flow.google.com')) {
        return NextResponse.json(
          { error: 'projectId or flow.google.com project url required' },
          { status: 400 }
        );
      }

      // Ensure browser is up, then navigate to the project and open login stream
      let live = await bibAccountStatus(id).catch(() => null);
      if (!live?.running && live?.status !== 'READY' && live?.status !== 'NEEDS_LOGIN') {
        live = await bibLaunchAccount(id, {
          maxSlots: account.maxParallelLimit,
          projectIds: Array.isArray(account.flowProjectIds)
            ? (account.flowProjectIds as string[])
            : undefined,
          profileDir: account.profileDir,
        });
      }

      await bibNavigate(id, targetUrl);

      const browserStatus =
        live?.status === 'READY'
          ? BrowserStatus.READY
          : live?.status === 'NEEDS_LOGIN'
            ? BrowserStatus.NEEDS_LOGIN
            : BrowserStatus.STARTING;

      await prisma.providerAccount.update({
        where: { id },
        data: {
          browserStatus,
          activeProjectId: projectId || account.activeProjectId,
          projectUrl: targetUrl,
          bibLastSeenAt: new Date(),
          bibLastError: null,
        },
      });

      return NextResponse.json({
        success: true,
        action: 'open_project',
        projectId: projectId || null,
        url: targetUrl,
        viewerUrl: bibViewerUrl(id, { url: targetUrl }),
        live,
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    await prisma.providerAccount
      .update({
        where: { id },
        data: {
          browserStatus: BrowserStatus.ERROR,
          bibLastError: e.message || 'BiB error',
        },
      })
      .catch(() => null);
    return NextResponse.json({ error: e.message || 'BiB action failed' }, { status: 500 });
  }
}
