import { createHash } from "node:crypto";

import { and, type Database, like, lt, rateLimit, sql } from "@synoro/db";

/**
 * A rate limit for public procedures, the counterpart of Better Auth's own
 * (which covers only `/api/account/*`). Counters live in the same
 * `rate_limits` table, so a limit holds across pods and restarts; our keys
 * start with `orpc:`, which Better Auth's (`<ip>|<path>`) never do.
 *
 * Fixed window: the first hit opens a window of `windowSeconds`, the next
 * `limit` hits in it pass, the rest do not, and the first hit after it starts
 * a new one. One statement, so concurrent requests cannot both slip under it.
 */

const PREFIX = "orpc:";

/** Rows older than this are of no use to any window and are swept. */
const SWEEP_AFTER_SECONDS = 24 * 60 * 60;

/** About one hit in a hundred sweeps; the table doesn't grow without bound. */
const SWEEP_CHANCE = 0.01;

/**
 * Counts one hit on `key` and says whether it is within the limit. `key` is
 * `<what>:<who>`; keep personal data out of it (use `rateLimitKeyPart`).
 */
export async function withinRateLimit(
  db: Database,
  input: { key: string; limit: number; windowSeconds: number },
  now = Date.now(),
) {
  const key = `${PREFIX}${input.key}`;
  const windowMs = input.windowSeconds * 1000;
  // A window that has run out starts again with this hit.
  const expired = sql`${rateLimit.lastRequest} <= ${now - windowMs}`;
  const [row] = await db
    .insert(rateLimit)
    .values({ id: crypto.randomUUID(), key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimit.count} + 1 end`,
        lastRequest: sql`case when ${expired} then ${now} else ${rateLimit.lastRequest} end`,
      },
    })
    .returning({ count: rateLimit.count });

  if (Math.random() < SWEEP_CHANCE) {
    await db
      .delete(rateLimit)
      .where(
        and(
          like(rateLimit.key, `${PREFIX}%`),
          lt(rateLimit.lastRequest, now - SWEEP_AFTER_SECONDS * 1000),
        ),
      )
      .catch(() => undefined);
  }
  return (row?.count ?? 1) <= input.limit;
}

/** A value for a limit key without keeping it: an email goes in as a hash. */
export function rateLimitKeyPart(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

/**
 * The caller's address as the proxy in front of the app saw it, or null
 * without one (local development, tests). Same source as the sign-in history
 * (`x-forwarded-for`, the first entry: Traefik replaces what a client sends).
 */
export function clientIp(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded ? forwarded.slice(0, 64) : null;
}
