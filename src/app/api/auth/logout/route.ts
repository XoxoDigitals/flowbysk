import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { releaseProviderAccountIfIdle } from '@/lib/allocation';

export async function POST(req: Request) {
  try {
    const session = await getSessionUser(req);
    if (session?.userId) {
      await releaseProviderAccountIfIdle(session.userId).catch(() => false);
    }
  } catch {
    /* ignore */
  }

  const response = NextResponse.json({ success: true, message: 'Logged out successfully' });
  // Session cookie only — do NOT clear Studio tool localStorage (Storyteller / Bulk tools).
  response.cookies.delete('saas_token');
  return response;
}
