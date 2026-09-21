import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const BYPASS_COOKIE = "mod_admin";
const BYPASS_PARAM = "mod_admin";

function isAssetPath(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/download/") ||
    pathname.startsWith("/static") ||
    pathname.startsWith("/favicon") ||
    pathname === "/maintenance-status.json" ||
    /\.(?:ico|png|jpg|jpeg|gif|svg|webp|css|js|map|txt|woff2?|json)$/i.test(pathname)
  );
}

function publicOrigin(req: NextRequest): string {
  const xfHost = (req.headers.get("x-forwarded-host") || "").split(",")[0].trim();
  const host = xfHost || (req.headers.get("host") || "").split(",")[0].trim();
  const xfProto = (req.headers.get("x-forwarded-proto") || "").split(",")[0].trim();
  const proto =
    xfProto ||
    (host && !/^(localhost|127\.0\.0\.1)(:|$)/i.test(host)
      ? "https"
      : req.nextUrl.protocol.replace(":", "") || "http");
  if (host) return `${proto}://${host}`;
  const env = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (env) return env;
  return req.nextUrl.origin;
}

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const { pathname } = url;

  // Never block API / download — Express handles these via rewrites
  if (pathname.startsWith("/api/") || pathname.startsWith("/download/")) {
    return NextResponse.next();
  }

  if (url.searchParams.has(BYPASS_PARAM)) {
    const cleanUrl = url.clone();
    cleanUrl.searchParams.delete(BYPASS_PARAM);
    const dest = new URL(cleanUrl.pathname + cleanUrl.search + cleanUrl.hash, publicOrigin(req));
    const res = NextResponse.redirect(dest);
    res.cookies.set(BYPASS_COOKIE, "1", {
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      sameSite: "lax",
    });
    return res;
  }

  if (req.cookies.get(BYPASS_COOKIE)?.value === "1") {
    return NextResponse.next();
  }

  if (pathname === "/maintenance" || isAssetPath(pathname)) {
    return NextResponse.next();
  }

  let maintenance = false;
  try {
    const flagUrl = new URL("/maintenance-status.json", req.nextUrl.origin);
    const r = await fetch(flagUrl, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (r.ok) {
      const data = await r.json();
      maintenance = !!data.maintenanceMode;
    }
  } catch {
    /* ignore */
  }

  if (maintenance) {
    return NextResponse.rewrite(new URL("/maintenance", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};