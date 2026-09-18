import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/auth';
import {
  allocateDataImpulseForAccount,
  fetchDataImpulseUsage,
  isDataImpulseReady,
  publicDataImpulseConfig,
  readDataImpulseConfig,
  reassignAllDataImpulse,
  testDataImpulseConnection,
  writeDataImpulseConfig,
  aggregateProxyStats,
  type DataImpulseConfig,
} from '@/lib/dataimpulse';
import { prisma } from '@/lib/prisma';
import { BrowserStatus } from '@prisma/client';

export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    const cfg = readDataImpulseConfig();
    const url = new URL(req.url);
    const includeUsage = url.searchParams.get('usage') === '1';
    const includeStats = url.searchParams.get('stats') === '1';
    const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days')) || 7));

    const body: Record<string, unknown> = {
      success: true,
      settings: publicDataImpulseConfig(cfg),
      ready: isDataImpulseReady(cfg),
      assignments: Object.entries(cfg.accountMeta).map(([accountId, m]) => ({
        accountId,
        country: m.country,
        sessId: m.sessId.slice(0, 8) + '…',
        port: m.port,
        gen: m.gen,
        updatedAt: m.updatedAt,
      })),
    };

    if (includeStats) {
      body.stats = aggregateProxyStats(days);
    }
    if (includeUsage) {
      body.usage = await fetchDataImpulseUsage();
    }

    return NextResponse.json(body);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json().catch(() => ({}));
    const prev = readDataImpulseConfig();

    const patch: Partial<DataImpulseConfig> = {};
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body.proxyLogin === 'string') patch.proxyLogin = body.proxyLogin.trim();
    if (typeof body.proxyPassword === 'string' && body.proxyPassword && body.proxyPassword !== '••••••••') {
      patch.proxyPassword = body.proxyPassword;
    }
    if (typeof body.apiToken === 'string' && body.apiToken && !/^•+$/.test(body.apiToken)) {
      patch.apiToken = body.apiToken.trim();
    }
    if (Array.isArray(body.countries)) {
      patch.countries = body.countries.map((c: unknown) => String(c || '').toLowerCase());
    }
    if (body.stickyPortBase !== undefined) {
      patch.stickyPortBase = Number(body.stickyPortBase) || 10000;
    }
    if (body.sessttlMinutes !== undefined) {
      patch.sessttlMinutes = Number(body.sessttlMinutes) || 60;
    }
    if (typeof body.autoAssignOnLaunch === 'boolean') {
      patch.autoAssignOnLaunch = body.autoAssignOnLaunch;
    }

    const next = writeDataImpulseConfig(patch);

    // Optionally reassign live accounts when enabling / credentials saved
    let reassigned = 0;
    if (body.reassignLive === true && isDataImpulseReady(next)) {
      const accounts = await prisma.providerAccount.findMany({
        where: {
          OR: [
            { browserStatus: BrowserStatus.READY },
            { browserStatus: BrowserStatus.NEEDS_LOGIN },
            { profileDir: { not: null } },
          ],
        },
        select: { id: true },
      });
      reassignAllDataImpulse(accounts.map((a) => a.id));
      reassigned = accounts.length;
    }

    return NextResponse.json({
      success: true,
      settings: publicDataImpulseConfig(next),
      ready: isDataImpulseReady(next),
      reassigned,
      wasEnabled: prev.enabled,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    if (action === 'test') {
      const result = await testDataImpulseConnection(
        typeof body.country === 'string' ? body.country : undefined
      );
      return NextResponse.json({ success: result.ok, ...result }, { status: result.ok ? 200 : 400 });
    }

    if (action === 'allocate') {
      const accountId = String(body.accountId || '').trim();
      if (!accountId) {
        return NextResponse.json({ error: 'accountId required' }, { status: 400 });
      }
      const r = allocateDataImpulseForAccount(accountId, { forceNew: !!body.forceNew });
      if (!r) {
        return NextResponse.json(
          { error: 'DataImpulse not enabled or credentials missing' },
          { status: 400 }
        );
      }
      return NextResponse.json({
        success: true,
        accountId,
        country: r.country,
        port: r.port,
        proxyId: r.proxyId,
      });
    }

    if (action === 'usage') {
      const usage = await fetchDataImpulseUsage();
      return NextResponse.json({ success: usage.ok, usage });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}
