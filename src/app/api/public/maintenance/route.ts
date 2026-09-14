import { NextResponse } from 'next/server';
import { readSiteRuntime } from '@/lib/siteRuntime';
import { startProxyAutoRotateLoop } from '@/lib/proxyAutoRotate';

export const runtime = 'nodejs';

/** Public maintenance flag for middleware + status checks. */
export async function GET() {
  // Idempotent — starts Node timer without instrumentation.ts (avoids Edge fs bundling).
  startProxyAutoRotateLoop();
  const rt = readSiteRuntime();
  return NextResponse.json(
    {
      maintenanceMode: !!rt.maintenanceMode,
      updatedAt: rt.updatedAt,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
