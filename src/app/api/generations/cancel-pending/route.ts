import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { cancelPendingJobs } from '@/lib/queue';

/**
 * POST — cancel pending jobs scoped to Storyteller (or explicit ids).
 * Body: { source?: 'storyteller' | 'bulkt2v' | 'bulkt2i' | 'bulki2v', jobIds?: string[], runIds?: string[] }
 * Does NOT cancel unrelated Studio / All Media generations.
 */
export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    let body: { source?: string; jobIds?: string[]; runIds?: string[] } = {};
    try {
      body = await req.json();
    } catch (_) {
      body = {};
    }

    const source = body.source || 'storyteller';
    const result = await cancelPendingJobs(session.userId, {
      source,
      jobIds: Array.isArray(body.jobIds) ? body.jobIds : [],
      runIds: Array.isArray(body.runIds) ? body.runIds : [],
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to cancel pending jobs' },
      { status: 400 }
    );
  }
}
