import { NextResponse } from 'next/server';
import { createStudioLog } from '@/lib/studioLogs';

function expectedInternalSecret(): string {
  return (
    process.env.INTERNAL_API_SECRET ||
    process.env.JWT_SECRET ||
    'dev-studio-logs'
  );
}

function isAllowed(req: Request): boolean {
  const expected = expectedInternalSecret();
  const header = (req.headers.get('x-internal-secret') || '').trim();
  if (header && header === expected) return true;
  // Accept legacy default used by Python when .env wasn't loaded into the worker
  if (header && (header === 'dev-studio-logs' || header === expected)) return true;

  // Local worker → Next on same machine (Host / X-Forwarded-* variants)
  const host = (req.headers.get('x-forwarded-host') || req.headers.get('host') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const fwd = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const isLocalHost =
    !host ||
    host === 'localhost' ||
    host.startsWith('localhost:') ||
    host === '127.0.0.1' ||
    host.startsWith('127.0.0.1:') ||
    host === '[::1]' ||
    host.startsWith('[::1]:');
  const isLocalFwd =
    !fwd ||
    fwd === '127.0.0.1' ||
    fwd === '::1' ||
    fwd.startsWith('127.') ||
    fwd === 'localhost';
  if (isLocalHost && isLocalFwd) return true;

  // Dev convenience
  if (process.env.NODE_ENV !== 'production') return true;

  return false;
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
