import { NextResponse } from 'next/server';
import { createStudioLog } from '@/lib/studioLogs';
import { isInternalRequestAllowed } from '@/lib/internalAuth';

function isAllowed(req: Request): boolean {
  return isInternalRequestAllowed(req);
}

/** Ingest from FastAPI worker (and other trusted local writers). */
export async function POST(req: Request) {
  try {
    if (!isAllowed(req)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const entry = await createStudioLog({
      level: body.level,
      message: body.message,
      source: body.source,
      runId: body.runId || body.run_id,
      userId: body.userId || body.user_id,
      userEmail: body.userEmail || body.user_email,
      flowEmail: body.flowEmail || body.flow_email,
      details: body.details ?? null,
    });
    if (!entry) {
      return NextResponse.json({ success: true, skipped: true, reason: 'run_cancelled' });
    }
    return NextResponse.json({ success: true, entry });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to write studio log' },
      { status: 400 }
    );
  }
}
