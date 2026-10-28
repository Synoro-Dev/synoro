import { env, paths } from "@synoro/config";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

import { appUrl, bookingRedirect, hostConfig, practiceHost } from "~/lib/hosts";

const hosts = hostConfig();

// Redirects go to `appUrl`, not `request.url`: behind the ingress the
// standalone server builds that from HOSTNAME:PORT (https://0.0.0.0:3000).

/** Open without a session on the app's own host. */
const PUBLIC_PATHS = [paths.auth.root, "/p/", "/b/", "/site/", "/api/auth"];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // A practice's own host (`anna.<root>`, `anna-ivanova.ru`): `/` is its booking
  // page. Sign-in and the cabinet stay on the app host, where the session
  // cookie lives, so other pages redirect there; assets are served as is.
  const host = practiceHost(request.headers.get("host"), hosts);
  if (host) {
    if (pathname === "/") {
      return NextResponse.rewrite(
        new URL(`${paths.booking.site(host)}${search}`, request.url),
      );
    }
    // The only API path the matcher lets through: Better Auth must never set
    // a session cookie on a domain the practice owner controls. The rest of
    // /api stays reachable here (the booking page calls /api/orpc on this
    // host; Caddy asks /api/domains/tls via the internal `app` host).
    if (pathname.startsWith("/api/")) {
      return NextResponse.redirect(new URL(`${pathname}${search}`, appUrl));
    }
    if (pathname.startsWith("/_next") || /\.[a-z0-9]+$/i.test(pathname)) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL(`${pathname}${search}`, appUrl));
  }

  // Demo stand: no sign-in screens, everyone is the seeded demo user. A stale
  // cookie (the demo is reset nightly) ends up here via the page's own
  // redirect to the login page.
  if (
    env.DEMO_LOGIN_EMAIL &&
    (pathname === paths.auth.login || pathname === paths.auth.signup)
  ) {
    return NextResponse.redirect(new URL(paths.auth.demo, appUrl));
  }

  // One main address for a booking page: synoro.ru/p/anna, not app.synoro.ru.
  const main = bookingRedirect(
    { pathname, search, host: request.headers.get("host") },
    env.BOOKING_URL,
  );
  if (main) return NextResponse.redirect(main, 308);

  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(request, {
    cookiePrefix: env.AUTH_COOKIE_PREFIX,
  });

  // THIS IS NOT SECURE!
  // This is the recommended approach to optimistically redirect users
  // We recommend handling auth checks in each page/route
  if (!sessionCookie) {
    if (env.DEMO_LOGIN_EMAIL) {
      const demo = new URL(paths.auth.demo, appUrl);
      demo.searchParams.set("next", `${pathname}${search}`);
      return NextResponse.redirect(demo);
    }
    return NextResponse.redirect(new URL(paths.auth.login, appUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/auth/:path*",
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|apple-touch-icon.png).*)",
  ],
};
