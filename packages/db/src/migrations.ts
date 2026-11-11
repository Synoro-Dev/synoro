import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";

import type { Database } from "./client";
import { findPgError } from "./errors";

/** Absolute path to the drizzle-kit `out` folder (`packages/db/migrations`). */
export const migrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

// Same bookkeeping table drizzle-kit / drizzle-orm's migrator use.
const MIGRATIONS_SCHEMA = sql.identifier("drizzle");
const MIGRATIONS_TABLE = sql.identifier("__drizzle_migrations");

async function rows<T>(db: Database, query: ReturnType<typeof sql>) {
  const result: unknown = await db.execute(query);
  // node-postgres and PGlite both expose `rows`.
  return (result as { rows: T[] }).rows;
}

/**
 * Adopts migrations on a database whose schema was created with
 * `drizzle-kit push` before `packages/db/migrations` existed.
 *
 * Records `0000_init` as applied without running it, so `db:migrate` only
 * applies the migrations after it. The migrator decides what to run by
 * comparing timestamps, so one row is enough.
 *
 * - Fresh database (no `users` table): throws — run `db:migrate` instead.
 * - Migrations already tracked: does nothing and returns `"already-tracked"`.
 */
export async function baselineMigrations(
  db: Database,
  folder = migrationsFolder,
): Promise<"baselined" | "already-tracked"> {
  const [init] = readMigrationFiles({ migrationsFolder: folder });
  if (!init) throw new Error(`No migrations found in ${folder}`);

  const [existing] = await rows<{ table: string | null }>(
    db,
    sql`select to_regclass('public.users')::text as "table"`,
  );
  if (!existing?.table) {
    throw new Error(
      "No existing schema found (public.users is missing). " +
        "This is a fresh database: run `bun db:migrate` instead.",
    );
  }

  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${MIGRATIONS_SCHEMA}`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  if ((await appliedMigrationCount(db)) > 0) {
    return (await adoptSquashedHistory(db, folder))
      ? "baselined"
      : "already-tracked";
  }

  await db.execute(sql`
    insert into ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} ("hash", "created_at")
    values (${init.hash}, ${init.folderMillis})
  `);
  return "baselined";
}

// Last table created by the migrations that were folded into `0000`.
const SQUASHED_MARKER = "public.booking_series";

/**
 * Databases migrated before `0000` was regenerated from the whole schema still
 * track the old chain (`0000`–`0010`). Their schema is already there, but the
 * new `0000` is newer than every tracked row, so the migrator would run it
 * again and fail with "already exists".
 *
 * When the journal has rows but not the new `0000`, none of them is newer than
 * it, and the schema is complete (the last table of the old chain exists),
 * replaces the old rows with the new `0000`. No-op everywhere else, so it is
 * safe to call before every `migrate()`.
 */
export async function adoptSquashedHistory(
  db: Database,
  folder = migrationsFolder,
): Promise<boolean> {
  const [init] = readMigrationFiles({ migrationsFolder: folder });
  if (!init || (await appliedMigrationCount(db)) === 0) return false;

  const [state] = await rows<{
    current: number;
    latest: string | null;
    complete: string | null;
  }>(
    db,
    sql`select
      count(*) filter (where "hash" = ${init.hash})::int as "current",
      max("created_at")::text as "latest",
      to_regclass(${SQUASHED_MARKER})::text as "complete"
      from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`,
  );
  if (!state || state.current > 0 || !state.complete) return false;
  if (Number(state.latest) >= init.folderMillis) return false;

  await db.transaction(async (tx) => {
    await tx.execute(sql`delete from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`);
    await tx.execute(sql`
      insert into ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} ("hash", "created_at")
      values (${init.hash}, ${init.folderMillis})
    `);
  });
  return true;
}

/** Rows in the migrations table (0 when it doesn't exist yet). */
export async function appliedMigrationCount(db: Database) {
  const [table] = await rows<{ name: string | null }>(
    db,
    sql`select to_regclass('drizzle.__drizzle_migrations')::text as "name"`,
  );
  if (!table?.name) return 0;

  const [tracked] = await rows<{ count: number }>(
    db,
    sql`select count(*)::int as "count" from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`,
  );
  return tracked?.count ?? 0;
}

// Postgres SQLSTATEs for "object already exists".
const ALREADY_EXISTS = new Set(["42P07", "42710", "42701", "42P06"]);
// Node / pg network errors.
const UNREACHABLE = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNRESET",
]);

/**
 * Turns a failed `migrate()` into a readable message plus the next step.
 * drizzle-kit's own `migrate` prints only a spinner and exit code 1.
 */
export function explainMigrationError(error: unknown): {
  message: string;
  hint?: string;
} {
  const pg = findPgError(error);
  const text = pg.message || pg.errors?.[0]?.message || String(error);
  const message = [text, pg.detail]
    .filter(Boolean)
    .join("\n  ")
    .concat(pg.code ? ` (${pg.code})` : "");

  if (pg.code && ALREADY_EXISTS.has(pg.code)) {
    return {
      message,
      hint:
        "The database already contains this schema, most likely created with " +
        "`bun db:push` before migrations existed. Adopt it once with " +
        "`bun db:baseline`, then run `bun db:migrate` again.\n" +
        "If these tables belong to another app, point POSTGRES_URL at a " +
        "dedicated database instead.",
    };
  }
  const dropped = /connection (terminated|error)/i.test(text);
  if ((pg.code && UNREACHABLE.has(pg.code)) || dropped) {
    return {
      message,
      hint:
        "Can't reach Postgres or the connection dropped; migrations run in a " +
        "transaction, so nothing was applied. Check POSTGRES_URL in the root " +
        ".env and the network, then retry; for the local database run " +
        "`docker compose up -d postgres`.",
    };
  }
  return { message };
}
