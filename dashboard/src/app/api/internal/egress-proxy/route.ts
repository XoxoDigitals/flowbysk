import { NextResponse } from 'next/server';
import { getAdminSiteSettings } from '@/lib/site-settings';
import { isInternalRequestAllowed } from '@/lib/internalAuth';
import { readEgressProxyMirror, writeEgressProxyMirror } from '@/lib/egressProxy';

/**
 * Egress proxy URL for BiB + Python worker.
 * Secret-gated. Prefer DB; fall back to mirror file.
 */
export async function GET(req: Request) {
  if (!isInternalRequestAllowed(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const settings = await getAdminSiteSettings();
    try {
      writeEgressProxyMirror(settings.egressProxies);
    } catch {
      /* ignore mirror write */
    }
    return NextResponse.json({
      ok: true,
      url: settings.egressProxyUrl || '',
      proxies: settings.egressProxies,
    });
  } catch (error: any) {
    const mirror = readEgressProxyMirror();
    return NextResponse.json({
      ok: true,
      url: mirror.url || '',
      proxies: mirror.proxies,
      error: error?.message,
    });
  }
}
