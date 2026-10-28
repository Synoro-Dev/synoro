import { env, logger } from "@synoro/config";
import { db as appDb, type Database, sql } from "@synoro/db";

import { seedDemoPractice } from "./seed";

/**
 * Nightly reset of the demo stand (demo.synoro.ru), run by the CronJob in
 * infra/synoro/demo.yaml from the tools image: empties every table of the
 * demo database and seeds the demo practice again, around today's date.
 *
 * Truncate and seed share one transaction. The truncate holds its locks until
 * the commit, so visitors wait a second or two and then see the fresh data,
 * never an empty database. Schema and migration history stay as they are.
 *
 * Refuses anything but the database named `synoro_demo` of a deployment with
 * DEMO_LOGIN_EMAIL set, so a wrong POSTGRES_URL (production's) can't be wiped.
 */

export function isDemoResetTarget(
  target: Pick<typeof env, "POSTGRES_URL" | "DEMO_LOGIN_EMAIL">,
) {
  if (!target.DEMO_LOGIN_EMAIL) return false;
  try {
    const url = new URL(target.POSTGRES_URL ?? "");
    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.pathname === "/synoro_demo" &&
      !url.search &&
      !url.hash
    );
  } catch {
    // Missing or malformed connection settings are never a reset target.
    return false;
  }
}

export async function main(
  db: Database = appDb,
  target: Pick<typeof env, "POSTGRES_URL" | "DEMO_LOGIN_EMAIL"> = env,
) {
  if (!isDemoResetTarget(target)) {
    logger.error("demo.reset_refused", undefined, {
      reason:
        "needs DEMO_LOGIN_EMAIL and a POSTGRES_URL of the database synoro_demo without query overrides",
    });
    return 1;
  }

  const { tables, practice } = await db.transaction(async (tx) => {
    const result: unknown = await tx.execute(
      sql`select tablename from pg_tables where schemaname = 'public'`,
    );
    const names = (result as { rows: { tablename: string }[] }).rows.map(
      (row) => row.tablename,
    );
    await tx.execute(
      sql`truncate table ${sql.join(
        names.map((name) => sql.identifier(name)),
        sql`, `,
      )} restart identity cascade`,
    );
    const seeded = await seedDemoPractice(tx);
    return { tables: names.length, practice: seeded.practice };
  });

  logger.info("demo.reset_done", { tables, practice: practice.slug });
  return 0;
}

if (import.meta.main) process.exit(await main());
