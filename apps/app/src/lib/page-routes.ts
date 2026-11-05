/**
 * Top-level routes of the app next to the booking pages (`/anna`). Every
 * name here must be in `RESERVED_SLUGS` (`page-routes.test.ts` checks it, and
 * that no route of `src/app` is missing). No imports on purpose:
 * `next.config.ts` reads this file.
 */
export const APP_ROOTS = [
  "api",
  "auth",
  "b",
  "bookings",
  "demo",
  "ingest",
  "p",
  "practices",
  "settings",
  "site",
] as const;

/** One path segment shaped like a slug (3–48 letters, digits, hyphens). */
const SLUG_SEGMENT = "[a-z0-9][a-z0-9-]{1,46}[a-z0-9]";

/** A segment that is a booking page, not one of the app's own routes. */
const PAGE_SEGMENT = `(?!(?:${APP_ROOTS.join("|")})$)${SLUG_SEGMENT}`;

/**
 * `source` patterns for `next.config` headers. A booking page may sit in an
 * iframe on the specialist's site; every other path, the cabinet and sign-in
 * included, may not. The two patterns never both match a path.
 */
export const EMBEDDABLE_SOURCE = `/:slug(${PAGE_SEGMENT})`;
export const SECURE_SOURCE = `/:path((?!${PAGE_SEGMENT}$).*)`;

/**
 * What search engines must not index: the cabinet, sign-in, and the booking
 * pages on `synoro.ru/<slug>`, which would compete with the landing on its own
 * host. `/` is left out: on a practice's own domain it is the page to find
 * (proxy.ts rewrites it after this header is decided); on the app host it
 * only redirects.
 */
export const NOINDEX_SOURCE =
  "/:path((?!_next/|favicon\\.ico$|icon\\.svg$|apple-touch-icon\\.png$|robots\\.txt$).+)";
