import { index, pgTable } from "drizzle-orm/pg-core";

import { user } from "../auth/user";

/**
 * Mails that must go out once per occasion, keyed by what they are about:
 * `pro:ending:<userId>:<ends at>`. A notice is claimed by inserting its key
 * before it is sent (a second worker or a retry finds the key taken) and
 * given back by deleting it when sending fails. Notices about one booking
 * keep their marks on the booking itself (`bookings.reminder_*_sent_at`).
 */
export const SentNotice = pgTable(
  "sent_notices",
  (t) => ({
    key: t.varchar({ length: 200 }).notNull().primaryKey(),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sentAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (table) => [index("sent_notices_user_idx").on(table.userId)],
);
