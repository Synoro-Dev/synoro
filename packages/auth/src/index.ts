import { logger } from "@synoro/config";
import { type Database, db } from "@synoro/db";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, emailOTP, oAuthProxy } from "better-auth/plugins";

import { demoLogin } from "./demo-login";
import { type GeoLookup, lookupGeo } from "./geo";
import { ADMIN_ROLE, hasAdminRole, isAdminEmail } from "./roles";
import { recordSignIn } from "./sign-in-log";

export function initAuth<
  TExtraPlugins extends BetterAuthPlugin[] = [],
>(options: {
  baseUrl: string;
  productionUrl: string;
  secret: string | undefined;
  sendEmail?: (data: {
    email: string;
    otp?: string;
    url?: string;
    type: "sign-in" | "email-verification" | "forget-password" | "change-email";
  }) => Promise<void>;
  /**
   * Runs a promise after the response is sent (e.g. Next.js `after`).
   * Without it, emails are awaited inside the request.
   */
  runInBackground?: (promise: Promise<unknown>) => void;
  /**
   * Parent domain to share the session cookie on, e.g. `.synoro.ru` so a
   * sign-in on app.synoro.ru also signs the user in on synoro.ru.
   */
  cookieDomain?: string;
  /**
   * Prefix of the auth cookie names instead of `better-auth`, so deployments
   * whose cookies reach the same host (prod's `.synoro.ru` cookie on
   * demo.synoro.ru) don't read each other's session.
   */
  cookiePrefix?: string;
  /**
   * Where the handler is mounted instead of Better Auth's `/api/auth`, so the
   * URL doesn't name the library. The client needs the same value.
   */
  basePath?: string;
  /**
   * Origins besides `baseUrl` allowed to call the auth API and to be used in
   * `callbackURL` (Better Auth rejects any other cross-origin request).
   */
  trustedOrigins?: string[];
  /**
   * Demo stand only: the seeded account `auth.api.signInDemo()` signs in.
   * Unset, the endpoint refuses everything.
   */
  demoLoginEmail?: string;
  extraPlugins?: TExtraPlugins;
  /**
   * Called once for every account that gets created (sign-up by code or
   * password), after the response when `runInBackground` is set. Failures
   * are logged and never break sign-up.
   */
  onUserCreated?: (user: {
    id: string;
    name: string;
    email: string;
  }) => Promise<void>;
  /** City by IP for the sign-in history; defaults to the `GEOIP_URL` service. */
  lookupGeo?: GeoLookup;
  /** Defaults to the app database; tests pass an in-memory PGlite one. */
  database?: Database;
}) {
  const config = {
    database: drizzleAdapter(options.database ?? db, {
      provider: "pg",
    }),
    baseURL: options.baseUrl,
    ...(options.basePath && { basePath: options.basePath }),
    secret: options.secret,
    // `baseUrl` is always trusted; these are the other hosts serving the app.
    ...(options.trustedOrigins?.length && {
      trustedOrigins: options.trustedOrigins,
    }),
    /**
     * OTP, password-reset and verification emails go through Better Auth's
     * background tasks: the response no longer waits for the email provider,
     * so a slow or failing provider can't break sign-in, and response time
     * doesn't reveal whether an account exists. Failures are logged.
     *
     * `cookieDomain` shares the session cookie with sibling subdomains;
     * `cookiePrefix` renames the cookies.
     * `disableOriginCheck: false` is the production behaviour, stated
     * explicitly because Better Auth otherwise skips origin checks under
     * NODE_ENV=test, which would hide trustedOrigins mistakes from tests.
     * @see https://www.better-auth.com/docs/reference/options#advanced
     */
    advanced: {
      disableOriginCheck: false,
      ...(options.runInBackground && {
        backgroundTasks: { handler: options.runInBackground },
      }),
      ...(options.cookieDomain && {
        crossSubDomainCookies: {
          enabled: true,
          domain: options.cookieDomain,
        },
      }),
      ...(options.cookiePrefix && { cookiePrefix: options.cookiePrefix }),
    },
    /**
     * Built-in rate limiting protects auth endpoints (sign-in, OTP, password
     * reset) from brute-force and abuse. Tune per environment as needed.
     *
     * Counters live in Postgres (`rate_limits` table) so limits hold across
     * pods and restarts; the default in-memory store is per-process.
     * @see https://www.better-auth.com/docs/concepts/rate-limit
     */
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }) => {
        if (options.sendEmail) {
          await options.sendEmail({
            email: user.email,
            url,
            type: "forget-password",
          });
        }
      },
    },
    plugins: [
      oAuthProxy({
        productionURL: options.productionUrl,
      }),
      /**
       * The main way in: a 6-digit code mailed to the address. `sign-in`
       * codes also sign up unknown addresses; the password is secondary.
       * `expiresIn` matches the "10 minutes" promised in the email.
       */
      emailOTP({
        otpLength: 6,
        expiresIn: 10 * 60,
        async sendVerificationOTP(data) {
          if (options.sendEmail) {
            await options.sendEmail({
              email: data.email,
              otp: data.otp,
              type: data.type,
            });
          }
        },
      }),
      /**
       * Roles, bans and impersonation; endpoints under <basePath>/admin/*
       * (`authClient.admin.*`). `adminProcedure` checks the same role.
       * @see https://www.better-auth.com/docs/plugins/admin
       */
      admin({ adminRoles: [ADMIN_ROLE] }),
      demoLogin({ email: options.demoLoginEmail }),
      ...(options.extraPlugins ?? []),
    ],
    // ADMIN_EMAILS bootstrap: listed emails sign up as admins, and existing
    // listed accounts are promoted on their next sign-in.
    databaseHooks: {
      user: {
        create: {
          async before(user) {
            // Email-code sign-up creates the user with an empty name.
            const name = user.name || user.email.split("@")[0] || user.email;
            return {
              data: {
                ...user,
                name,
                ...(isAdminEmail(user.email) && { role: ADMIN_ROLE }),
              },
            };
          },
          async after(user) {
            if (!options.onUserCreated) return;
            const notify = options
              .onUserCreated({
                id: user.id,
                name: user.name,
                email: user.email,
              })
              .catch((error: unknown) =>
                logger.warn("auth.user_created_hook_failed", {
                  error: error instanceof Error ? error.message : String(error),
                }),
              );
            if (options.runInBackground) options.runInBackground(notify);
            else await notify;
          },
        },
      },
      session: {
        create: {
          async after(session, ctx) {
            // The history of sign-ins (admin site); never throws.
            await recordSignIn(
              options.database ?? db,
              {
                userId: session.userId,
                ipAddress: session.ipAddress,
                userAgent: session.userAgent,
                impersonatedBy: (session as { impersonatedBy?: string | null })
                  .impersonatedBy,
                path: ctx?.path,
                headers: ctx?.headers ?? ctx?.request?.headers,
              },
              {
                lookupGeo: options.lookupGeo ?? lookupGeo,
                runInBackground: options.runInBackground,
              },
            );
            if (!ctx) return;
            const adapter = ctx.context.internalAdapter;
            const user = await adapter.findUserById(session.userId);
            if (!user || !isAdminEmail(user.email)) return;
            // `role` comes from the admin plugin; the adapter types the base user.
            if (hasAdminRole((user as { role?: unknown }).role)) return;
            await adapter.updateUser(user.id, { role: ADMIN_ROLE });
          },
        },
      },
    },
    // Better Auth's own lines go through our JSON logger and its LOG_LEVEL
    // instead of colored console text.
    logger: {
      log(level, message, ...args) {
        const meta = args.length > 0 ? { args } : undefined;
        if (level === "error") logger.error(message, undefined, meta);
        else logger[level](message, meta);
      },
    },
    onAPIError: {
      onError(error) {
        logger.error("auth.api_error", error);
      },
    },
  } satisfies BetterAuthOptions;

  return betterAuth(config);
}

export type Auth = ReturnType<typeof initAuth>;
export type Session = Auth["$Infer"]["Session"];
