import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Edge proxy (formerly "middleware"): guards the dashboard with a cheap
 * cookie-presence check. It deliberately does NOT redirect authenticated users
 * away from /login based on cookie presence — the cookie isn't validated here
 * (no DB on the edge), and pairing an optimistic redirect with the layout's
 * authoritative `auth.api.getSession` check causes a redirect loop when a stale
 * or invalid session cookie is present. Authoritative checks live in the
 * dashboard layout and route handlers.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/dashboard") && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
