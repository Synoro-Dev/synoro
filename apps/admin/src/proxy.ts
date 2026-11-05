import { env } from "@synoro/config";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/account"];

/**
 * Optimistic only: without a session cookie go to /login. Pages enforce
 * admin rights themselves (`requireAdmin`), and the API (`adminProcedure`).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }
  const cookie = getSessionCookie(request, {
    cookiePrefix: env.AUTH_COOKIE_PREFIX,
  });
  if (!cookie) {
    // Behind the ingress `request.url` is the pod's own address.
    return NextResponse.redirect(new URL("/login", env.ADMIN_URL));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-touch-icon.png|robots.txt).*)",
  ],
};
