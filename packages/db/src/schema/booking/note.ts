import { sql } from "drizzle-orm";
import { index, pgTable } from "drizzle-orm/pg-core";

import { user } from "../auth/user";
import { Booking } from "./booking";
import { Practice, PracticeMember } from "./practice";

/**
 * The specialist's own working notes on a client, optionally tied to one of
 * their sessions. Often health data (a special category under 152-FZ), so
 * only the practice's owner reads or writes them — not its administrators,
 * not a Synoro admin signed in as the owner — and `body` is stored
 * encrypted (`encryptSecret`, the `v1:<iv>:<tag>:<ciphertext>` form).
 */
export const ClientNote = pgTable(
  "client_notes",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    practiceId: t
      .uuid()
      .notNull()
      .references(() => Practice.id, { onDelete: "cascade" }),
    /** The client; their notes go with them when they leave the practice. */
    memberId: t
      .uuid()
      .notNull()
      .references(() => PracticeMember.id, { onDelete: "cascade" }),
    /** The session the note is about; null for a note on the client. */
    bookingId: t.uuid().references(() => Booking.id, { onDelete: "set null" }),
    /** Encrypted text; never read it without `decryptSecret`. */
    body: t.text().notNull(),
    authorId: t.text().references(() => user.id, { onDelete: "set null" }),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("client_notes_member_idx").on(table.memberId, table.createdAt),
    index("client_notes_booking_idx").on(table.bookingId),
  ],
);
