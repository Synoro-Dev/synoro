import { logger } from "@synoro/config";
import type { Database } from "@synoro/db";
import { and, desc, eq, isNotNull, SignIn } from "@synoro/db";

import { type Geo, type GeoLookup, isPublicIp } from "./geo";
import { readVisitSource } from "./visit-source";

export interface SignInEvent {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  impersonatedBy?: string | null;
  /** Auth endpoint that opened the session. */
  path?: string | null;
  /** The request's headers: the source cookies come from them. */
  headers?: Headers | null;
}

const cut = (value: string | null | undefined, max: number) =>
  value ? value.slice(0, max) : null;

/** A city already looked up for this address: a person signs in from one IP again and again. */
async function knownGeo(db: Database, ip: string): Promise<Geo | null> {
  const [row] = await db
    .select({
      country: SignIn.country,
      region: SignIn.region,
      city: SignIn.city,
    })
    .from(SignIn)
    .where(and(eq(SignIn.ipAddress, ip), isNotNull(SignIn.city)))
    .orderBy(desc(SignIn.createdAt))
    .limit(1);
  return row ?? null;
}

async function fillGeo(
  db: Database,
  id: string,
  ip: string,
  lookup: GeoLookup,
) {
  try {
    if (!isPublicIp(ip)) return;
    const geo = (await knownGeo(db, ip)) ?? (await lookup(ip));
    if (!geo) return;
    await db.update(SignIn).set(geo).where(eq(SignIn.id, id));
  } catch (error) {
    logger.warn("auth.sign_in_geo_failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Writes one row of the sign-in history (docs/sign-in-history.md). It must
 * never break a sign-in, so failures are logged and swallowed. The city comes
 * after the response when `runInBackground` is given (a slow geo service must
 * not delay the sign-in), inline otherwise.
 */
export async function recordSignIn(
  db: Database,
  event: SignInEvent,
  options: {
    lookupGeo: GeoLookup;
    runInBackground?: (promise: Promise<unknown>) => void;
  },
) {
  try {
    const source = readVisitSource(event.headers);
    const ip = cut(event.ipAddress, 64);
    const [row] = await db
      .insert(SignIn)
      .values({
        userId: event.userId,
        method: cut(event.path, 100),
        impersonatedBy: event.impersonatedBy ?? null,
        ipAddress: ip,
        userAgent: cut(event.userAgent, 400),
        ...source,
      })
      .returning({ id: SignIn.id });
    if (!row || !ip) return;

    const geo = fillGeo(db, row.id, ip, options.lookupGeo);
    if (options.runInBackground) options.runInBackground(geo);
    else await geo;
  } catch (error) {
    logger.error("auth.sign_in_log_failed", error);
  }
}
