import { index, pgTable } from "drizzle-orm/pg-core";

import { user } from "../auth/user";

/**
 * Mails that must go out once per occasion, keyed by what they are about:
 * `pro:ending:<userId>:<ends at>`. Sending claims the key until
 * `claimExpiresAt`; `sentAt` is set once the mail is handed over. A failed
 * send deletes the claim, a crashed worker's claim expires and can be taken
 * again, and `claimToken` keeps a late worker from touching a newer claim.
 * Notices about one booking keep their marks on the booking itself
 * (`bookings.reminder_*_sent_at`).
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
