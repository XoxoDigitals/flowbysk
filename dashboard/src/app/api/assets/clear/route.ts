import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';
import { softPurgeUserMedia } from '@/lib/mediaPurge';

/**
 * POST /api/assets/clear — wipe gallery media for this user.
 * Keeps GenerationJob rows so user/admin analytics stay accurate.
 */
export async function POST(req: Request) {
  try {
    const session = await getOrCreateStudioUser(req);
    const result = await softPurgeUserMedia(session.userId);
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    console.error('assets/clear failed:', err);
    return NextResponse.json({ error: err.message || 'Clear failed' }, { status: 500 });
  }
}
