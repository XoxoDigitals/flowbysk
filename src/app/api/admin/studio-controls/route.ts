import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  getStudioToolSettings,
  saveStudioToolSettings,
  STUDIO_TOOL_IDS,
  STUDIO_TOOL_LABELS,
  getStudioQueueControl,
  setStudioQueuePaused,
} from '@/lib/studioTools';
import { checkAndDispatchNextJobs } from '@/lib/queue';

export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const [tools, queue] = await Promise.all([getStudioToolSettings(), getStudioQueueControl()]);
    return NextResponse.json({
      success: true,
      tools,
      toolIds: STUDIO_TOOL_IDS,
      toolLabels: STUDIO_TOOL_LABELS,
      queue,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const admin = await requireAdmin(req);
    const body = await req.json();

    if (body.tools && typeof body.tools === 'object') {
      const tools = await saveStudioToolSettings(body.tools);
      return NextResponse.json({ success: true, tools });
    }

    if (typeof body.queuePaused === 'boolean') {
      const queue = await setStudioQueuePaused(
        body.queuePaused,
        admin.email || 'admin'
      );
      if (!body.queuePaused) {
        // Resume — kick the dispatcher
        checkAndDispatchNextJobs().catch(console.error);
      }
      return NextResponse.json({ success: true, queue });
    }

    return NextResponse.json({ error: 'Provide tools{} or queuePaused' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Forbidden' },
      { status: error.message === 'FORBIDDEN' ? 403 : 500 }
    );
  }
}
