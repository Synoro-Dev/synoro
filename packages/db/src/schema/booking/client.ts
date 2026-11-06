import { sql } from "drizzle-orm";
import { index, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

import { ImportBatch } from "../data/import";
import { Practice } from "./practice";

/**
 * A client brought in from a table or another service: a card the practice
 * keeps, with no account behind it. The person never sees it and gets nothing
 * by mail, because mail goes to accounts and accounts come only from the person
 * themselves. It must not become an account: an imported address could be
 * someone else's, and joining them to a practice would show its staff their
 * phone (the same reason `practice.addMember` only invites).
 */
export const PracticeClient = pgTable(
  "practice_clients",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    practiceId: t
      .uuid()
      .notNull()
      .references(() => Practice.id, { onDelete: "cascade" }),
    name: t.varchar({ length: 120 }).notNull(),
    /** E.164. */
    phone: t.varchar({ length: 20 }),
    /** Lowercase. */
    email: t.text(),
    note: t.varchar({ length: 2000 }),
    /** Consultations left, as the old service said; not spendable until asked. */
    credits: t.integer().notNull().default(0),
    /** The import that brought it, for undoing. */
    batchId: t
      .uuid()
      .references(() => ImportBatch.id, { onDelete: "set null" }),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("practice_clients_practice_idx").on(table.practiceId),
    uniqueIndex("practice_clients_practice_phone_idx")
      .on(table.practiceId, table.phone)
      .where(sql`${table.phone} is not null`),
    uniqueIndex("practice_clients_practice_email_idx")
      .on(table.practiceId, table.email)
      .where(sql`${table.email} is not null`),
  ],
);
