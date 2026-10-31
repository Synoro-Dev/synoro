import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import type { Database } from "../client";
import {
  adoptSquashedHistory,
  appliedMigrationCount,
  explainMigrationError,
  migrationsFolder,
} from "../migrations";
import * as schema from "../schema";

/**
 * `bun db:migrate`: applies pending SQL from `packages/db/migrations`.
 *
 * Replaces `drizzle-kit migrate`, which hides the database error behind a
 * spinner and exit code 1. Connects with node-postgres over TCP, on the
 * direct port, and applies pending migrations in a single transaction.
 *
 * Plain console output and `process.env` on purpose: this is a CLI for
 * humans, and `@synoro/config` is consumed from `dist/`, which would force a
 * build before the first migration on a fresh clone.
 */
/**
 * A dropped connection also rejects the running query, and that rejection is
 * what `main` reports. Without listeners, the same failure is re-emitted as an
 * unhandled `error` event (on the pool or a checked-out client) and dumps a
 * stack trace over the readable message.
 */
function silenceConnectionErrors(pool: Pool) {
  const ignore = () => {};
  pool.on("error", ignore);
  pool.on("connect", (client: { on(event: "error", fn: () => void): void }) =>
    client.on("error", ignore),
  );
}

function connect(url: string) {
  const pool = new Pool({
    connectionString: url.replace(":6543", ":5432"),
    // pg waits forever by default; fail fast with a readable error.
    connectionTimeoutMillis: 15_000,
  });
  silenceConnectionErrors(pool);
  const db = drizzle({ client: pool, schema, casing: "snake_case" });
  return {
    db: db as Database,
    migrate: () => migrate(db, { migrationsFolder }),
    close: () => pool.end(),
  };
}

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    console.error("✗ POSTGRES_URL is not set (root .env).");
    return 1;
  }

  const { db, migrate, close } = connect(url);

  try {
    if (await adoptSquashedHistory(db)) {
      console.log("• Migration history was regenerated; re-linked 0000.");
    }
    const before = await appliedMigrationCount(db);
    await migrate();
    const applied = (await appliedMigrationCount(db)) - before;

    console.log(
      applied > 0
        ? `✓ Applied ${applied} migration(s).`
        : "✓ Database is up to date.",
    );
    return 0;
  } catch (error) {
    const { message, hint } = explainMigrationError(error);
    console.error(`✗ Migration failed: ${message}`);
    if (hint) console.error(`\n${hint}`);
    return 1;
  } finally {
    await close();
  }
}

process.exit(await main());
