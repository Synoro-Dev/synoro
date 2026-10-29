import { index, pgTable } from "drizzle-orm/pg-core";

import { user } from "../auth/user";

/**
 * Mails that must go out once per occasion, keyed by what they are about:
 * `pro:ending:<userId>:<ends at>`. A pending notice has an expiring claim;
 * `sentAt` is set only after delivery. Claim tokens fence off stale workers.
 * Failed sends release the claim; crashed workers' claims can be reclaimed.
 * Notices about one booking keep their marks on the booking itself (`bookings.reminder_*_sent_at`).
 */
export const SentNotice = pgTable(
  "sent_notices",
  (t) => ({
    key: t.varchar({ length: 200 }).notNull().primaryKey(),
    userId: t
      .text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sentAt: t.timestamp({ withTimezone: true }),
    claimToken: t.uuid(),
    claimExpiresAt: t.timestamp({ withTimezone: true }),
  }),
  (table) => [index("sent_notices_user_idx").on(table.userId)],
);
