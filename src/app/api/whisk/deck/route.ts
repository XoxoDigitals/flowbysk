import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';

/** Empty decks — users upload their own Whisk ingredients. */
export async function GET(req: Request) {
  try {
    await getOrCreateStudioUser(req);
    return NextResponse.json({
      success: true,
      deck: { subject: [], scene: [], style: [] },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unauthorized' }, { status: 401 });
  }
}
