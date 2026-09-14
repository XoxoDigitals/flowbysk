import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getAdminSiteSettings, updateSiteSettings } from '@/lib/site-settings';

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
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
    return NextResponse.json({ success: true, settings });
  } catch (error: any) {
    const msg = error.message || 'Forbidden';
    const status = msg === 'FORBIDDEN' ? 403 : msg.startsWith('Invalid proxy') ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
