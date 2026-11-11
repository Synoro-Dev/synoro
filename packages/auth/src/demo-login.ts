import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

import { DEMO_ACCOUNT_EMAILS, DEMO_DOMAIN } from "./demo-accounts";
import { hasAdminRole, isAdminEmail } from "./roles";

/**
 * Passwordless sign-in for the demo stand: `auth.api.signInDemo()` opens a
 * session for `options.email`, the seeded demo account, or — with `body.email`
 * — for another of the seeded demo accounts (`DEMO_ACCOUNTS`), so a visitor
 * can look at the cabinet from every role.
 *
 * Server-only (`SERVER_ONLY`): not routed over HTTP, only the app's own
 * `/auth/demo` handler can call it. Without `options.email` it is a 404, and
 * it refuses anything but plain `@example.com` accounts, so a stray
 * `DEMO_LOGIN_EMAIL` on a real deployment can't open a real or admin account.
 */
export const demoLogin = (options: { email?: string }) =>
  ({
    id: "demo-login",
    endpoints: {
      signInDemo: createAuthEndpoint(
        "/sign-in/demo",
        {
          method: "POST",
          metadata: { SERVER_ONLY: true },
          body: z.object({ email: z.string().optional() }).optional(),
        },
        async (ctx) => {
          const fallback = options.email?.trim().toLowerCase();
          if (!fallback?.endsWith(DEMO_DOMAIN)) throw new APIError("NOT_FOUND");

          const requested = ctx.body?.email?.trim().toLowerCase();
          if (requested && !DEMO_ACCOUNT_EMAILS.has(requested)) {
            throw new APIError("NOT_FOUND");
          }
          const email = requested ?? fallback;

          const found =
            await ctx.context.internalAdapter.findUserByEmail(email);
          // Between the nightly truncate and the end of the seed.
          if (!found) {
            throw new APIError("SERVICE_UNAVAILABLE", {
              message: "Demo account is not ready",
            });
          }
          // `role` comes from the admin plugin; the adapter types the base user.
          const role = (found.user as { role?: unknown }).role;
          if (isAdminEmail(email) || hasAdminRole(role)) {
            throw new APIError("FORBIDDEN");
          }

          const session = await ctx.context.internalAdapter.createSession(
            found.user.id,
          );
          await setSessionCookie(ctx, { session, user: found.user });
          return ctx.json({ ok: true });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
