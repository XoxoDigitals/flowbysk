import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { createStudioLog } from '@/lib/studioLogs';

/** Authenticated Studio UI → Prisma (user-scoped write). */
export async function POST(req: Request) {
  try {
    const session = await getSessionUser(req);
    if (!session?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const entry = await createStudioLog({
      level: body.level,
      message: body.message,
      source: body.source || 'ui',
      runId: body.runId || body.run_id || null,
      userId: session.userId,
      userEmail: session.email || null,
      flowEmail: body.flowEmail || body.flow_email || null,
      details: body.details ?? null,
    });
    return NextResponse.json({ success: true, entry });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to write log' },
      { status: 400 }
    );
  }
}
