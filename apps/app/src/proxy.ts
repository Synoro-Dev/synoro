import { env, paths } from "@synoro/config";
import { legacyPracticePath, practiceSlugOfPath } from "@synoro/validators";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

import { appUrl, bookingRedirect, hostConfig, practiceHost } from "~/lib/hosts";

const hosts = hostConfig();

// Redirects go to `appUrl`, not `request.url`: behind the ingress the
// standalone server builds that from HOSTNAME:PORT (https://0.0.0.0:3000).

/**
 * Open without a session on the app's own host. Booking pages (`/anna`) are
 * too, matched by `practiceSlugOfPath`; the old `/p/` only redirects.
 */
const PUBLIC_PATHS = [paths.auth.root, "/p/", "/b/", "/site/", paths.api.auth];

/**
 * A 308 to a path on the host the request came to. The origin is built from
 * the headers, not `request.url` (the standalone server's HOSTNAME:PORT), and
 * Next rejects a relative `Location` from a proxy.
 */
function redirectToPath(request: NextRequest, path: string) {
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    request.nextUrl.protocol.replace(":", "");
  const host = request.headers.get("host") || request.nextUrl.host;
  return NextResponse.redirect(new URL(path, `${proto}://${host}`), 308);
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // The old address of a booking page, `/p/anna` and its photo, became `/anna`.
  // First of all: a practice's own host serves the photo too.
  const current = legacyPracticePath(pathname);
  const currentUrl = current && `${current}${search}`;

  // A practice's own host (`anna-ivanova.ru`): `/` is its booking page. Sign-in
  // and the cabinet stay on the app host, where the session cookie lives, so
  // other pages redirect there; assets are served as is.
  const host = practiceHost(request.headers.get("host"), hosts);
  if (host) {
    if (currentUrl) return redirectToPath(request, currentUrl);
    if (pathname === "/") {
      return NextResponse.rewrite(
        new URL(`${paths.booking.site(host)}${search}`, request.url),
      );
    }
    // The only API path the matcher lets through: the auth handler must never set
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

  // One main address for a booking page: synoro.ru/anna, not app.synoro.ru.
  const main = bookingRedirect(
    { pathname, search, host: request.headers.get("host") },
    env.BOOKING_URL,
  );
  if (main) return NextResponse.redirect(main, 308);
  if (currentUrl) return redirectToPath(request, currentUrl);

  if (
    practiceSlugOfPath(pathname) ||
    PUBLIC_PATHS.some((path) => pathname.startsWith(path))
  ) {
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
    // A literal (Next reads it statically): same as `paths.api.auth`.
    "/api/account/:path*",
    // `demo/`: the demo practice's photo, shown on its public booking page.
    "/((?!api|ingest|_next/static|_next/image|demo/|favicon.ico|icon.svg|apple-touch-icon.png|robots\\.txt$).*)",
  ],
};
