import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const BYPASS_COOKIE = 'mod_admin';
const BYPASS_PARAM = 'mod_admin';

function isAssetPath(pathname: string) {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/favicon') ||
    pathname === '/maintenance-status.json' ||
    /\.(?:ico|png|jpg|jpeg|gif|svg|webp|css|js|map|txt|woff2?|json)$/i.test(pathname)
  );
}

/** Public site origin behind nginx/proxy (avoid redirecting to localhost:3100). */
function publicOrigin(req: NextRequest): string {
  const xfHost = (req.headers.get('x-forwarded-host') || '').split(',')[0].trim();
  const host = xfHost || (req.headers.get('host') || '').split(',')[0].trim();
  const xfProto = (req.headers.get('x-forwarded-proto') || '').split(',')[0].trim();
  const proto =
    xfProto ||
    (host && !/^(localhost|127\.0\.0\.1)(:|$)/i.test(host) ? 'https' : req.nextUrl.protocol.replace(':', '') || 'http');
  if (host) return `${proto}://${host}`;
  const env = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  if (env) return env;
  return req.nextUrl.origin;
}

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const { pathname } = url;

  // Anyone with ?mod_admin gets a long-lived bypass cookie
  if (url.searchParams.has(BYPASS_PARAM)) {
    const clean = url.clone();
    clean.searchParams.delete(BYPASS_PARAM);
    const dest = new URL(clean.pathname + clean.search + clean.hash, publicOrigin(req));
    const res = NextResponse.redirect(dest);
    res.cookies.set(BYPASS_COOKIE, '1', {
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
      sameSite: 'lax',
    });
    return res;
  }

  if (req.cookies.get(BYPASS_COOKIE)?.value === '1') {
    return NextResponse.next();
  }

  if (pathname === '/maintenance' || isAssetPath(pathname)) {
    return NextResponse.next();
  }

  // Read static public flag — avoids self-fetch deadlock with /api (which failed open before).
  let maintenance = false;
  try {
    // Prefer internal origin for server-side fetch; public origin as fallback
    const flagUrl = new URL('/maintenance-status.json', req.nextUrl.origin);
    const r = await fetch(flagUrl, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (r.ok) {
      const data = await r.json();
      maintenance = !!data.maintenanceMode;
    }
  } catch {
    /* layout still enforces */
  }

  if (maintenance) {
    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/public/maintenance') return NextResponse.next();
      return NextResponse.json(
        { error: 'Site is under maintenance', maintenanceMode: true },
        { status: 503 }
      );
    }
    return NextResponse.rewrite(new URL('/maintenance', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
