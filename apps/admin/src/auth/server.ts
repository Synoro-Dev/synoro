import "server-only";

import { initAuth } from "@synoro/auth";
import { isAdmin } from "@synoro/auth/roles";
import { env, logger } from "@synoro/config";
import { db, eq, user } from "@synoro/db";
import { dispatchEmail, newUserNotice } from "@synoro/jobs";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { cache } from "react";

import { AUTH_BASE_PATH } from "./paths";

/**
 * Same users, sessions and cookie as apps/app (`AUTH_COOKIE_DOMAIN` shares
 * it between app.synoro.ru and admin.synoro.ru), served from this host so
 * sign-in and sign-out stay on it.
 */
export const auth = initAuth({
  baseUrl: env.ADMIN_URL,
  productionUrl: env.ADMIN_URL,
  secret: env.AUTH_SECRET,
  cookieDomain: env.AUTH_COOKIE_DOMAIN,
  cookiePrefix: env.AUTH_COOKIE_PREFIX,
  basePath: AUTH_BASE_PATH,
  extraPlugins: [nextCookies()],
  runInBackground: (promise) => {
    try {
      after(promise);
    } catch {
      void promise;
    }
  },
  // An ADMIN_EMAILS address signing in here first creates its account: the
  // team hears of it as of any other (TEAM_NOTICE_EMAIL).
  onUserCreated: async (user) => {
    const notice = newUserNotice(user);
    if (notice) await dispatchEmail(notice);
  },
  // The only way in here is a sign-in code, and it is mailed to admins only:
  // anyone else gets the same "code sent" answer but no mail, so this host
  // neither creates accounts nor tells which addresses are admins.
  sendEmail: async ({ email, otp, type }) => {
    if (type !== "sign-in" || !otp) {
      logger.warn("admin.auth_email_skipped", { type });
      return;
    }
    // ADMIN_EMAILS count before their account exists: the first code creates it.
    const found = await db.query.user.findFirst({
      where: eq(user.email, email.toLowerCase()),
      columns: { email: true, role: true },
    });
    if (!isAdmin(found ?? { email })) {
      logger.warn("admin.sign_in_code_refused");
      return;
    }
    await dispatchEmail({
      template: "otp-sign-in",
      to: [email],
      subject: "Код для входа в админку Synoro",
      props: { otp, isSignUp: false },
    });
  },
});

const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

/**
 * Every admin page and query starts here: no session → sign-in, a session
 * without admin rights → /forbidden. `adminProcedure` checks again.
 */
export async function requireAdmin() {
  const session = await getSession();
  if (!session) redirect("/login");
  // Verified, as in `adminProcedure`: a password sign-up on the app doesn't
  // confirm the address, a code sign-in here does.
  if (!session.user.emailVerified || !isAdmin(session.user)) {
    redirect("/forbidden");
  }
  return session;
}
