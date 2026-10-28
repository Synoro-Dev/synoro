import "server-only";

import { initAuth } from "@synoro/auth";
import { env, logger } from "@synoro/config";
import { dispatchEmail } from "@synoro/jobs";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { after } from "next/server";
import { cache } from "react";

import { appUrl } from "~/lib/hosts";

const productionUrl = env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
  : env.APP_URL;

export const auth = initAuth({
  baseUrl: appUrl,
  productionUrl,
  secret: env.AUTH_SECRET,
  cookieDomain: env.AUTH_COOKIE_DOMAIN,
  cookiePrefix: env.AUTH_COOKIE_PREFIX,
  trustedOrigins: env.AUTH_TRUSTED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  demoLoginEmail: env.DEMO_LOGIN_EMAIL,
  extraPlugins: [nextCookies()],
  // Send emails after the response. `after` only works inside a request
  // (route handler, server action); elsewhere the promise, which Better Auth
  // already guards with `.catch`, just runs unawaited.
  runInBackground: (promise) => {
    try {
      after(promise);
    } catch {
      void promise;
    }
  },
  // Used by the emailOTP plugin and password reset. Goes through the Hatchet
  // `send-email` task when HATCHET_CLIENT_TOKEN is set, inline otherwise.
  sendEmail: async ({
    email,
    otp,
    url,
    type,
  }: {
    email: string;
    otp?: string;
    url?: string;
    type: "sign-in" | "email-verification" | "forget-password" | "change-email";
  }) => {
    if (type === "forget-password") {
      if (!url) {
        logger.error("auth.reset_email_missing_url");
        throw new Error(
          "Cannot send password reset email: reset URL is missing",
        );
      }
      await dispatchEmail({
        template: "reset-password",
        to: [email],
        subject: "Сброс пароля",
        props: { resetLink: url },
      });
    } else {
      if (!otp) {
        logger.error("auth.otp_email_missing_otp", undefined, { type });
        throw new Error(`Cannot send ${type} email: OTP is missing`);
      }
      await dispatchEmail({
        template: "otp-sign-in",
        to: [email],
        // The code in the subject is readable from the notification alone.
        subject:
          type === "sign-in"
            ? `${otp} — код для входа`
            : `${otp} — код подтверждения почты`,
        props: { otp, isSignUp: type !== "sign-in" },
      });
    }
  },
});

export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);
