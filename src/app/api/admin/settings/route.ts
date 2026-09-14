import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getAdminSiteSettings, updateSiteSettings } from '@/lib/site-settings';
import { startProxyAutoRotateLoop } from '@/lib/proxyAutoRotate';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    startProxyAutoRotateLoop();
    const settings = await getAdminSiteSettings();
    return NextResponse.json({ success: true, settings });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const settings = await updateSiteSettings({
      siteName: body.siteName,
      logoUrl: body.logoUrl === '' ? null : body.logoUrl,
      contactEmail: body.contactEmail,
      allowSignups: body.allowSignups,
      ticketSystemEnabled: body.ticketSystemEnabled,
      contactPageEnabled: body.contactPageEnabled,
      maintenanceMode: body.maintenanceMode,
      proxyAutoRotateEnabled: body.proxyAutoRotateEnabled,
      proxyAutoRotateMinutes: body.proxyAutoRotateMinutes,
      egressProxies: body.egressProxies !== undefined ? body.egressProxies : undefined,
      // Legacy single field only if list not sent
      egressProxyUrl:
        body.egressProxies !== undefined
          ? undefined
          : body.egressProxyUrl === undefined
            ? undefined
            : body.egressProxyUrl === ''
              ? null
              : body.egressProxyUrl,
    });
    const res = NextResponse.json({ success: true, settings });
    // Keep admin unlocked when turning maintenance on
    if (settings.maintenanceMode) {
      res.cookies.set('mod_admin', '1', {
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
        sameSite: 'lax',
      });
    }
    return res;
  } catch (error: any) {
    const msg = error.message || 'Forbidden';
    const status = msg === 'FORBIDDEN' ? 403 : msg.startsWith('Invalid proxy') ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
