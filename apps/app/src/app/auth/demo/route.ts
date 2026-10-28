import { DEMO_ACCOUNTS, isDemoAccountKey } from "@synoro/auth/demo";
import { env, logger, paths } from "@synoro/config";
import { APIError } from "better-auth/api";
import { connection, type NextRequest, NextResponse } from "next/server";

import { auth } from "~/auth/server";
import { appUrl } from "~/lib/hosts";

/** Only same-site paths: `//host` and `/\host` would leave the demo. */
function safeNext(next: string | null, home: string = paths.dashboard.root) {
  if (!next?.startsWith("/") || /^\/[/\\]/.test(next)) return home;
  return next;
}

/**
 * Demo stand (DEMO_LOGIN_EMAIL): signs the visitor in as the seeded demo
 * account and sends them on to `?next=`. The proxy lands here instead of the
 * login page. Anywhere else it does not exist.
 */
export async function GET(request: NextRequest) {
  // Env and cookies are read per request: without this the handler is
  // prerendered at build time, where DEMO_LOGIN_EMAIL is unset (a static 404).
  await connection();
  if (!env.DEMO_LOGIN_EMAIL) return new NextResponse(null, { status: 404 });

  // `?as=` picks the role to look from (`DEMO_ACCOUNTS`); no or an unknown
  // key signs in as DEMO_LOGIN_EMAIL.
  const key = request.nextUrl.searchParams.get("as");
  const persona = isDemoAccountKey(key) ? DEMO_ACCOUNTS[key] : undefined;

  try {
    await auth.api.signInDemo({
      headers: request.headers,
      ...(persona && { body: { email: persona.email } }),
    });
  } catch (error) {
    if (error instanceof APIError && error.statusCode === 503) {
      // The nightly reset is re-seeding. No redirect: the login page would
      // send the visitor straight back here.
      return new NextResponse("Демо обновляется. Попробуйте через минуту.", {
        status: 503,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "retry-after": "30",
        },
      });
    }
    logger.error("auth.demo_login_failed", error);
    return new NextResponse(null, { status: 500 });
  }

  return NextResponse.redirect(
    // `appUrl`, not `request.url`: behind the ingress the latter is 0.0.0.0:3000.
    new URL(
      safeNext(request.nextUrl.searchParams.get("next"), persona?.home),
      appUrl,
    ),
  );
}
