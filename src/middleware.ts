import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const BYPASS_COOKIE = 'mod_admin';
const BYPASS_PARAM = 'mod_admin';

function isAssetPath(pathname: string) {
  return (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/favicon') ||
    /\.(?:ico|png|jpg|jpeg|gif|svg|webp|css|js|map|txt|woff2?)$/i.test(pathname)
  );
}

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const { pathname } = url;

  // Anyone with ?mod_admin gets a long-lived bypass cookie
  if (url.searchParams.has(BYPASS_PARAM)) {
    const clean = url.clone();
    clean.searchParams.delete(BYPASS_PARAM);
    const res = NextResponse.redirect(clean);
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

  if (
    pathname === '/maintenance' ||
    pathname === '/api/public/maintenance' ||
    isAssetPath(pathname)
  ) {
    return NextResponse.next();
  }

  let maintenance = false;
  try {
    const r = await fetch(new URL('/api/public/maintenance', req.url), {
      headers: { 'x-middleware-check': '1' },
      cache: 'no-store',
    });
    if (r.ok) {
      const data = await r.json();
      maintenance = !!data.maintenanceMode;
    }
  } catch {
    /* fail open if status API unreachable */
  }

  if (maintenance) {
    if (pathname.startsWith('/api/')) {
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
