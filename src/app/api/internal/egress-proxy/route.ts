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
    const url = settings.egressProxyUrl || readEgressProxyMirror();
    try {
      writeEgressProxyMirror(url);
    } catch {
      /* ignore mirror write */
    }
    return NextResponse.json({ ok: true, url: url || '' });
  } catch (error: any) {
    const url = readEgressProxyMirror();
    return NextResponse.json({ ok: true, url: url || '', error: error?.message });
  }
}
