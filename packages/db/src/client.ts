import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Unified database type used across the codebase.
 *
 * `node-postgres` (the app) and PGlite (tests) extend `PgDatabase` with
 * different query-result HKTs but share the same relational query API for a
 * given schema.  Using `PgDatabase` as the common interface avoids unsafe
 * double-casting while keeping full access to select/insert/update/delete and
 * the relational `query` builder.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

function createDatabase(): Database {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error(
      "POSTGRES_URL environment variable is not set. Please configure it in your environment.",
    );
  }

  const pool = new Pool({ connectionString });
  return drizzle({ client: pool, schema, casing: "snake_case" });
}

export const db: Database = createDatabase();
