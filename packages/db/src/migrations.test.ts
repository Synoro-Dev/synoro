import { describe, expect, it } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import {
  appliedMigrationCount,
  baselineMigrations,
  explainMigrationError,
  migrationsFolder,
} from "./migrations";
import * as schema from "./schema";

const migrations = readMigrationFiles({ migrationsFolder });

/**
 * Simulates a database created with `drizzle-kit push`: the schema of the
 * first `count` migrations exists, but nothing is recorded as applied.
 */
async function pushedDb(count: number) {
  const client = new PGlite({ extensions: { btree_gist } });
  for (const migration of migrations.slice(0, count)) {
    for (const statement of migration.sql) await client.exec(statement);
  }
  return { client, db: drizzle({ client, schema, casing: "snake_case" }) };
}

async function hasTable(client: PGlite, name: string) {
  const { rows } = await client.query<{ table: string | null }>(
    `select to_regclass('public.${name}')::text as "table"`,
  );
  return rows[0]?.table != null;
}

describe("baselineMigrations", () => {
  it("adopts a pushed database so migrate applies only newer migrations", async () => {
    const { client, db } = await pushedDb(1);
    expect(await hasTable(client, "google_calendar_connections")).toBe(false);

    expect(await baselineMigrations(db)).toBe("baselined");
    await migrate(db, { migrationsFolder });

    expect(await hasTable(client, "google_calendar_connections")).toBe(true);
    expect(await baselineMigrations(db)).toBe("already-tracked");
    await client.close();
  });

  it("tolerates tables that were already pushed (idempotent 0001)", async () => {
    const { client, db } = await pushedDb(2);

    await baselineMigrations(db);
    await migrate(db, { migrationsFolder });

    expect(await hasTable(client, "google_calendar_connections")).toBe(true);
    await client.close();
  });

  it("refuses a fresh database", async () => {
    const { client, db } = await pushedDb(0);

    await expect(baselineMigrations(db)).rejects.toThrow(/fresh database/);
    await client.close();
  });
});

describe("explainMigrationError", () => {
  it("points a pushed database at db:baseline", async () => {
    const { client, db } = await pushedDb(1);

    const error = await migrate(db, { migrationsFolder }).catch((e) => e);
    const { message, hint } = explainMigrationError(error);

    expect(message).toContain('type "booking_kind" already exists');
    expect(message).toContain("(42710)");
    expect(hint).toContain("bun db:baseline");
    await client.close();
  });

  it("suggests starting Postgres when it is unreachable", () => {
    const error = new Error("Failed query", {
      cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
        code: "ECONNREFUSED",
      }),
    });

    expect(explainMigrationError(error).hint).toContain("docker compose");
  });

  it("uses the first inner message of an AggregateError", () => {
    const error = Object.assign(
      new AggregateError([new Error("connect ECONNREFUSED ::1:5432")], ""),
      { code: "ECONNREFUSED" },
    );

    expect(explainMigrationError(error).message).toBe(
      "connect ECONNREFUSED ::1:5432 (ECONNREFUSED)",
    );
  });

  it("explains a connection dropped mid-migration", () => {
    const error = new Error("Failed query: rollback", {
      cause: new Error("Connection terminated unexpectedly"),
    });
    const { message, hint } = explainMigrationError(error);

    expect(message).toBe("Connection terminated unexpectedly");
    expect(hint).toContain("nothing was applied");
  });

  it("returns the message without a hint for other errors", () => {
    expect(explainMigrationError(new Error("boom"))).toEqual({
      message: "boom",
    });
  });
});

describe("appliedMigrationCount", () => {
  it("counts tracked migrations, 0 before the table exists", async () => {
    const { client, db } = await pushedDb(0);

    expect(await appliedMigrationCount(db)).toBe(0);
    await migrate(db, { migrationsFolder });
    expect(await appliedMigrationCount(db)).toBe(migrations.length);
    await client.close();
  });
});

describe("notice claim leases migration", () => {
  it("preserves existing sent timestamps while allowing pending claims", async () => {
    const { client } = await pushedDb(9);
    try {
      await client.exec(`
        INSERT INTO users (id, name, email) VALUES ('owner', 'Owner', 'owner@notices.test');
        INSERT INTO sent_notices (key, user_id, sent_at)
          VALUES ('legacy', 'owner', '2026-10-01T12:00Z');
      `);
      const migration = migrations[9];
      if (!migration) throw new Error("Missing notice claim leases migration");
      for (const statement of migration.sql) await client.exec(statement);
      const { rows } = await client.query<{ sent_at: Date }>(
        "SELECT sent_at FROM sent_notices WHERE key = 'legacy'",
      );
      expect(rows[0]?.sent_at.toISOString()).toBe("2026-10-01T12:00:00.000Z");
      await client.exec(
        "INSERT INTO sent_notices (key, user_id) VALUES ('pending', 'owner')",
      );
      const pending = await client.query(
        "SELECT sent_at FROM sent_notices WHERE key = 'pending'",
      );
      expect(pending.rows).toEqual([{ sent_at: null }]);
    } finally {
      await client.close();
    }
  });
});

describe("bookings_no_overlap restoration", () => {
  it("preserves conflicting rows and fails before applying the constraint", async () => {
    const { client } = await pushedDb(2);
    try {
      await client.exec(`
        INSERT INTO "users" (id, name, email) VALUES ('owner', 'Owner', 'owner@test.local');
        INSERT INTO practices (id, owner_id, name, slug) VALUES ('00000000-0000-0000-0000-000000000001', 'owner', 'Practice', 'practice');
        INSERT INTO bookings (practice_id, kind, starts_at, ends_at) VALUES
          ('00000000-0000-0000-0000-000000000001', 'consultation', '2030-01-01T10:00Z', '2030-01-01T11:00Z'),
          ('00000000-0000-0000-0000-000000000001', 'free', '2030-01-01T10:30Z', '2030-01-01T11:00Z');
      `);
      const migration = migrations[2];
      if (!migration) throw new Error("Missing overlap migration");
      await expect(
        client.transaction(async (tx) => {
          for (const statement of migration.sql) await tx.exec(statement);
        }),
      ).rejects.toMatchObject({
        code: "23P01",
        message:
          "Active bookings overlap; bookings_no_overlap cannot be applied",
      });
      expect(
        (await client.query("SELECT * FROM bookings WHERE status = 'active'"))
          .rows,
      ).toHaveLength(2);
      expect(
        (
          await client.query(
            "SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap'",
          )
        ).rows,
      ).toHaveLength(0);
      // Resolve the conflict explicitly; retry installs the constraint.
      await client.exec(
        "UPDATE bookings SET status = 'cancelled' WHERE kind = 'free'",
      );
      for (const statement of migration.sql) await client.exec(statement);
      expect(
        (
          await client.query(
            "SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap'",
          )
        ).rows,
      ).toHaveLength(1);
      // Applying it again is still idempotent.
      for (const statement of migration.sql) await client.exec(statement);
    } finally {
      await client.close();
    }
  });
});

describe("booking cancel reason backfill", () => {
  it("infers why older bookings were cancelled", async () => {
    const { client } = await pushedDb(7);
    try {
      const practice = "00000000-0000-0000-0000-000000000001";
      const member = "00000000-0000-0000-0000-000000000002";
      const account = "00000000-0000-0000-0000-000000000003";
      const booking = (n: number) =>
        `00000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}`;
      await client.exec(`
        INSERT INTO users (id, name, email) VALUES
          ('owner', 'Owner', 'owner@test.local'),
          ('client', 'Client', 'client@test.local');
        INSERT INTO practices (id, owner_id, name, slug)
          VALUES ('${practice}', 'owner', 'Practice', 'practice');
        INSERT INTO practice_members (id, practice_id, user_id)
          VALUES ('${member}', '${practice}', 'client');
        INSERT INTO payment_accounts (id, practice_id, provider, merchant_id, secret)
          VALUES ('${account}', '${practice}', 'yookassa', 'shop', 'secret');
        INSERT INTO bookings
          (id, practice_id, kind, status, member_id, starts_at, ends_at,
           hold_until, cancelled_at, cancelled_by_id)
        VALUES
          ('${booking(1)}', '${practice}', 'consultation', 'cancelled', '${member}',
           '2030-01-01T10:00Z', '2030-01-01T11:00Z', '2029-12-01T10:15Z', '2029-12-01T10:16Z', NULL),
          ('${booking(2)}', '${practice}', 'consultation', 'cancelled', '${member}',
           '2030-01-02T10:00Z', '2030-01-02T11:00Z', '2029-12-01T10:15Z', '2029-12-01T10:16Z', NULL),
          ('${booking(3)}', '${practice}', 'consultation', 'cancelled', '${member}',
           '2030-01-03T10:00Z', '2030-01-03T11:00Z', NULL, '2029-12-01T10:00Z', 'client'),
          ('${booking(4)}', '${practice}', 'consultation', 'cancelled', '${member}',
           '2030-01-04T10:00Z', '2030-01-04T11:00Z', NULL, '2029-12-01T10:00Z', NULL),
          ('${booking(5)}', '${practice}', 'consultation', 'cancelled', '${member}',
           '2030-01-05T10:00Z', '2030-01-05T11:00Z', NULL, '2030-01-05T10:20Z', 'owner'),
          ('${booking(6)}', '${practice}', 'consultation', 'cancelled', '${member}',
           '2030-01-06T10:00Z', '2030-01-06T11:00Z', NULL, '2030-01-06T10:20Z', 'owner'),
          ('${booking(7)}', '${practice}', 'consultation', 'cancelled', '${member}',
           '2030-01-07T10:00Z', '2030-01-07T11:00Z', NULL, '2030-01-06T10:00Z', 'owner'),
          ('${booking(8)}', '${practice}', 'blocked', 'cancelled', NULL,
           '2030-01-08T10:00Z', '2030-01-08T11:00Z', NULL, '2030-01-08T10:20Z', 'owner'),
          ('${booking(9)}', '${practice}', 'consultation', 'active', '${member}',
           '2030-01-09T10:00Z', '2030-01-09T11:00Z', NULL, NULL, NULL);
        INSERT INTO payments
          (practice_id, account_id, member_id, booking_id, provider, status, credits, amount)
        VALUES
          ('${practice}', '${account}', '${member}', '${booking(1)}', 'yookassa', 'canceled', 1, 3000);
        INSERT INTO credit_entries (member_id, delta, reason, booking_id)
        VALUES ('${member}', 1, 'refund', '${booking(6)}');
      `);
      const migration = migrations[7];
      if (!migration) throw new Error("Missing cancel reason migration");
      for (const statement of migration.sql) await client.exec(statement);

      const { rows } = await client.query<{ id: string; reason: string }>(
        "SELECT id, cancel_reason AS reason FROM bookings ORDER BY id",
      );
      expect(rows.map((r) => r.reason)).toEqual([
        "payment_cancelled", // its payment was cancelled
        "hold_expired", // the hold ran out
        "client", // cancelled by the client
        "client", // by the guest link
        "no_show", // staff, after the start, nothing returned
        "staff", // staff, after the start, refunded
        "staff", // staff, before the start
        "staff", // reopened blocked time
        null, // still active
      ]);
    } finally {
      await client.close();
    }
  });
});
