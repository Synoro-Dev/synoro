/** Where the admin's Better Auth handler is mounted (same as apps/app). */
export const AUTH_BASE_PATH = "/api/account";

/**
 * The only auth endpoints the admin host serves: a sign-in code, signing in
 * with it, signing out, and the health route the probes call. `initAuth`
 * also has password sign-in and sign-up, which would skip the code (and its
 * admins-only mail): those, and everything else, answer 404 here.
 */
const ALLOWED = new Set([
  "/ok",
  "/email-otp/send-verification-otp",
  "/sign-in/email-otp",
  "/sign-out",
]);

export function isAllowedAuthPath(pathname: string) {
  return (
    pathname.startsWith(`${AUTH_BASE_PATH}/`) &&
    ALLOWED.has(pathname.slice(AUTH_BASE_PATH.length))
  );
}
