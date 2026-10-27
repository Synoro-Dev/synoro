import { paths } from "@acme/config";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

import { appUrl, hostConfig, practiceHost } from "~/lib/hosts";

const hosts = hostConfig();

/** Open without a session on the app's own host. */
const PUBLIC_PATHS = [paths.auth.root, "/p/", "/site/"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // A practice's own host (`anna.<root>`, `anna-psy.ru`): `/` is its booking
  // page. Sign-in and the cabinet stay on the app host, where the session
  // cookie lives, so other pages redirect there; assets are served as is.
  const host = practiceHost(request.headers.get("host"), hosts);
  if (host) {
    if (pathname === "/") {
      return NextResponse.rewrite(
        new URL(`${paths.booking.site(host)}${search}`, request.url),
      );
    }
    if (pathname.startsWith("/_next") || /\.[a-z0-9]+$/i.test(pathname)) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL(`${pathname}${search}`, appUrl));
  }

  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(request);

  // THIS IS NOT SECURE!
  // This is the recommended approach to optimistically redirect users
  // We recommend handling auth checks in each page/route
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
