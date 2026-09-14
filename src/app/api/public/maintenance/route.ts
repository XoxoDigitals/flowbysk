import { NextResponse } from 'next/server';
import { readSiteRuntime } from '@/lib/siteRuntime';

/** Public maintenance flag for middleware + status checks. */
export async function GET() {
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
