import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE_NAME = process.env.APP_SESSION_COOKIE_NAME || "dba_session";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  ) {
    return NextResponse.next();
  }

  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/api/auth/logout") ||
    pathname.startsWith("/api/auth/forgot-password") ||
    pathname.startsWith("/api/auth/reset-password")
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/alerts")) {
    return NextResponse.next();
  }

  // n8n calls this endpoint to deliver unsafe SQL queries for
  // approval — it has no session cookie, so it must bypass auth.
  if (pathname.startsWith("/api/chat/approval")) {
    return NextResponse.next();
  }

  // n8n calls this endpoint for datapump callback
  if (pathname.startsWith("/api/datapump/callback")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api")) {
    if (!hasSessionCookie && !pathname.startsWith("/api/auth/session")) {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (
    pathname === "/login" ||
    pathname === "/forgot-password" ||
    pathname === "/first-login-reset" ||
    pathname === "/reset-password"
  ) {
    return NextResponse.next();
  }

  if (!hasSessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"]
};
