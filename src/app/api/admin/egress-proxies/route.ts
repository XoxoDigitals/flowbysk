import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  activeEgressProxyUrl,
  EgressProxyEntry,
  normalizeEgressProxyList,
  probeProxyEgress,
  readEgressProxyMirror,
  writeEgressProxyMirror,
} from '@/lib/egressProxy';
import { prisma } from '@/lib/prisma';
import { readSiteRuntime } from '@/lib/siteRuntime';

async function syncDbBestEffort(proxies: EgressProxyEntry[]) {
  try {
    await prisma.siteSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        egressProxies: proxies as any,
        egressProxyUrl: activeEgressProxyUrl(proxies),
      },
      update: {
        egressProxies: proxies as any,
        egressProxyUrl: activeEgressProxyUrl(proxies),
      },
    });
  } catch (e) {
    console.warn('[egress-proxies] DB sync skipped:', e);
  }
}

/** GET — load proxy list (mirror first, then DB). */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const mirror = readEgressProxyMirror();
    let proxies = mirror.proxies;
    if (!proxies.length) {
      try {
        const row = await prisma.siteSettings.findUnique({ where: { id: 'default' } });
        proxies = normalizeEgressProxyList((row as any)?.egressProxies);
        if (!proxies.length && (row as any)?.egressProxyUrl) {
          proxies = normalizeEgressProxyList([
            { id: 'legacy', url: (row as any).egressProxyUrl, enabled: true },
          ]);
        }
        if (proxies.length) writeEgressProxyMirror(proxies);
      } catch {
        /* ignore */
      }
    }
    const rt = readSiteRuntime();
    return NextResponse.json({
      success: true,
      proxies,
      activeUrl: activeEgressProxyUrl(proxies),
      assignments: mirror.assignments || {},
      lastProxyRotateAt: rt.lastProxyRotateAt,
      lastProxyRotateReason: rt.lastProxyRotateReason,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}

/** PUT — save full proxy list (mirror is source of truth). */
export async function PUT(req: Request) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const incoming = Array.isArray(body.proxies) ? body.proxies : body.egressProxies;
    if (!Array.isArray(incoming)) {
      return NextResponse.json({ error: 'proxies array required' }, { status: 400 });
    }
    if (incoming.length > 0) {
      const normalized = normalizeEgressProxyList(incoming);
      if (!normalized.length) {
        return NextResponse.json(
          {
            error:
              'Invalid proxy URL(s). Use host:port:user:pass or http://user:pass@host:port.',
            },
            { status: 400 }
          );
      }
    }
    // Preserve geo fields from previous mirror when URL unchanged
    const prev = readEgressProxyMirror().proxies;
    const prevById = new Map(prev.map((p) => [p.id, p]));
    const prevByUrl = new Map(prev.map((p) => [p.url, p]));
    const proxies = normalizeEgressProxyList(incoming).map((p) => {
      const old = prevById.get(p.id) || prevByUrl.get(p.url);
      if (!old) return p;
      return {
        ...p,
        ip: p.ip ?? old.ip,
        country: p.country ?? old.country,
        countryCode: p.countryCode ?? old.countryCode,
        lastCheckedAt: p.lastCheckedAt ?? old.lastCheckedAt,
        lastError: p.lastError ?? old.lastError,
      };
    });

    writeEgressProxyMirror(proxies);
    await syncDbBestEffort(proxies);

    return NextResponse.json({
      success: true,
      proxies,
      activeUrl: activeEgressProxyUrl(proxies),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}

/** POST — check one proxy, or action=rotate to rotate + relaunch BiB (keeps login). */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = await req.json().catch(() => ({}));

    if (body.action === 'rotate') {
      const { performEgressProxyRotateAndRelaunch } = await import(
        '@/lib/unusualActivityProxyRotate'
      );
      const { maskProxyUrl } = await import('@/lib/egressProxy');
      const result = await performEgressProxyRotateAndRelaunch({ reason: 'manual' });
      const mirror = readEgressProxyMirror();
      const rt = readSiteRuntime();
      return NextResponse.json({
        success: result.ok,
        rotated: result.rotated,
        from: result.from ? maskProxyUrl(result.from) : null,
        to: result.to ? maskProxyUrl(result.to) : null,
        activeUrl: result.to,
        relaunched: result.relaunched,
        error: result.error,
        proxies: mirror.proxies,
        assignments: mirror.assignments,
        lastProxyRotateAt: rt.lastProxyRotateAt,
        lastProxyRotateReason: rt.lastProxyRotateReason,
      }, { status: result.ok ? 200 : 400 });
    }

    if (body.action === 'rotate-account') {
      const accountId = String(body.accountId || body.account_id || '').trim();
      if (!accountId) {
        return NextResponse.json({ error: 'accountId required' }, { status: 400 });
      }
      const { rotateProxyAndRelaunchForAccount } = await import(
        '@/lib/unusualActivityProxyRotate'
      );
      const { maskProxyUrl } = await import('@/lib/egressProxy');
      // Manual rotate: always hard-relaunch THIS account only (new sticky must bind in Chrome).
      const result = await rotateProxyAndRelaunchForAccount(accountId, {
        reason: `manual account ${accountId.slice(0, 8)}`,
        forceRelaunch: true,
      });

      let exitIp: string | null = null;
      let exitCountry: string | null = null;
      let port: number | null = null;
      if (result.ok && result.to) {
        try {
          const probe = await probeProxyEgress(result.to);
          if (probe.ok) {
            exitIp = probe.ip || null;
            exitCountry = probe.country || probe.countryCode || null;
            const mirrorNow = readEgressProxyMirror();
            const nextProxies = mirrorNow.proxies.map((p) => {
              if (p.url !== result.to && p.id !== `di-${accountId}`) return p;
              return {
                ...p,
                ip: exitIp,
                country: exitCountry,
                countryCode: probe.countryCode || null,
                lastCheckedAt: new Date().toISOString(),
                lastError: null,
              };
            });
            writeEgressProxyMirror(nextProxies, mirrorNow.assignments, mirrorNow.cycleUsed);
          }
        } catch (e) {
          console.warn('[egress-proxies] post-rotate probe:', e);
        }
        try {
          const { readDataImpulseConfig } = await import('@/lib/dataimpulse');
          const meta = readDataImpulseConfig().accountMeta[accountId];
          if (meta?.port) port = meta.port;
        } catch {
          /* ignore */
        }
      }

      const mirror = readEgressProxyMirror();
      const rt = readSiteRuntime();
      return NextResponse.json(
        {
          success: result.ok,
          rotated: result.rotated,
          deferred: !!result.deferred,
          from: result.from ? maskProxyUrl(result.from) : null,
          to: result.to ? maskProxyUrl(result.to) : null,
          accountId,
          relaunched: result.relaunched,
          error: result.error,
          exitIp,
          exitCountry,
          port,
          lastRotatedAt: new Date().toISOString(),
          proxies: mirror.proxies,
          assignments: mirror.assignments,
          lastProxyRotateAt: rt.lastProxyRotateAt,
          lastProxyRotateReason: rt.lastProxyRotateReason,
        },
        { status: result.ok ? 200 : 400 }
      );
    }

    const mirror = readEgressProxyMirror();
    let proxies = mirror.proxies;
    const id = typeof body.id === 'string' ? body.id : '';
    const urlRaw = typeof body.url === 'string' ? body.url : '';

    let target = id ? proxies.find((p) => p.id === id) : null;
    if (!target && urlRaw) {
      const list = normalizeEgressProxyList([{ id: id || 'tmp', url: urlRaw, enabled: true }]);
      target = list[0] || null;
    }
    if (!target) {
      target = proxies.find((p) => p.enabled) || proxies[0] || null;
    }
    if (!target?.url) {
      return NextResponse.json({ error: 'No proxy to check' }, { status: 400 });
    }

    const result = await probeProxyEgress(target.url);
    const checkedAt = new Date().toISOString();

    proxies = proxies.map((p) => {
      if (p.id !== target!.id && p.url !== target!.url) return p;
      if (result.ok) {
        return {
          ...p,
          ip: result.ip || null,
          country: result.country || null,
          countryCode: result.countryCode || null,
          lastCheckedAt: checkedAt,
          lastError: null,
        };
      }
      return {
        ...p,
        lastCheckedAt: checkedAt,
        lastError: result.error || 'check failed',
      };
    });

    // If checking a URL not yet in list, don't invent rows — only update existing
    if (proxies.some((p) => p.id === target!.id || p.url === target!.url)) {
      writeEgressProxyMirror(proxies);
      await syncDbBestEffort(proxies);
    }

    return NextResponse.json({
      success: result.ok,
      ...result,
      proxies,
      proxyId: target.id,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}
