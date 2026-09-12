import { NextResponse } from 'next/server';
import { getOrCreateStudioUser } from '@/lib/auth';

function isAllowedMediaUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    return (
      host === 'flow-content.google' ||
      host.endsWith('.googleusercontent.com') ||
      host.endsWith('.ggpht.com') ||
      host.endsWith('.google.com') ||
      host === 'localhost' ||
      host === '127.0.0.1'
    );
  } catch {
    return false;
  }
}

/** Authenticated proxy so Storyteller can ZIP cross-origin Flow images in one file. */
export async function GET(req: Request) {
  try {
    await getOrCreateStudioUser(req);
    const { searchParams } = new URL(req.url);
    const target = String(searchParams.get('url') || '').trim();
    if (!target || !isAllowedMediaUrl(target)) {
      return NextResponse.json({ error: 'Invalid media URL' }, { status: 400 });
    }

    const upstream = await fetch(target, {
      headers: { Accept: 'image/*,*/*' },
      redirect: 'follow',
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream fetch failed (${upstream.status})` },
        { status: 502 }
      );
    }

    const contentType = upstream.headers.get('content-type') || 'image/png';
    const buf = await upstream.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err: any) {
    const msg = err?.message || 'Proxy failed';
    const status = /unauthorized|unauthenticated|session/i.test(msg) ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
