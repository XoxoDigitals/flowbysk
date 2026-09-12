import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { cancelJob } from '@/lib/queue';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOrCreateStudioUser(req);
    const { id } = await params;

    // Force=true so All Media ✕ / Storyteller Stop can abandon GENERATING as well as IN_QUEUE.
    const result = await cancelJob(id, session.userId, { force: true });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to cancel job' },
      { status: 400 }
    );
  }
}
