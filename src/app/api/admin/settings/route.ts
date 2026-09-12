import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getSiteSettings, updateSiteSettings } from '@/lib/site-settings';

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const settings = await getSiteSettings();
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
    });
    return NextResponse.json({ success: true, settings });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}
