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
    const wantDownload = ['1', 'true', 'yes'].includes(
      String(searchParams.get('download') || '').toLowerCase()
    );
    const filename = String(searchParams.get('filename') || 'download').replace(/[^\w.\-]+/g, '_') || 'download';
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=300',
    };
    if (wantDownload) {
      headers['Content-Disposition'] = `attachment; filename="${filename}"`;
    }
    return new NextResponse(buf, {
      status: 200,
      headers,
    });
  } catch (err: any) {
    const msg = err?.message || 'Proxy failed';
    const status = /unauthorized|unauthenticated|session/i.test(msg) ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
