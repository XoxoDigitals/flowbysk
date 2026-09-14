import { NextResponse } from 'next/server';
import { resolveMaintenanceMode, readSiteRuntime } from '@/lib/siteRuntime';
import { startProxyAutoRotateLoop } from '@/lib/proxyAutoRotate';

export const runtime = 'nodejs';

/** Public maintenance flag for middleware + status checks. */
export async function GET() {
  startProxyAutoRotateLoop();
  const maintenanceMode = await resolveMaintenanceMode();
  const rt = readSiteRuntime();
  return NextResponse.json(
    {
      maintenanceMode,
      updatedAt: rt.updatedAt,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
