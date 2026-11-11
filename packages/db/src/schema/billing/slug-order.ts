import { sql } from "drizzle-orm";
import { check, index, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

import { user } from "../auth/user";
import { Practice } from "../booking/practice";
import { paymentStatus } from "../payment/payment";

/**
 * A specialist buying a premium address (`synoro.ru/max`) for their practice,
 * once, through the platform's Точка Банк acquiring. Same lifecycle as
 * `subscription_payments`: the bank is the source of truth, and the move to
 * `succeeded` gives the practice the address. While pending, the order holds
 * the name: at most one per slug, so one name is never sold twice.
 */
export const SlugOrder = pgTable(
  "slug_orders",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    /** The order number people read out: in the purpose at Точка and the receipt. */
    number: t
      .integer()
      .notNull()
      .unique()
      .generatedByDefaultAsIdentity({ startWith: 1001 }),
    /**
     * Both null once the account is deleted: tax law keeps the payment for
     * years, but not who made it.
     */
    userId: t.text().references(() => user.id, { onDelete: "set null" }),
    practiceId: t
      .uuid()
      .references(() => Practice.id, { onDelete: "set null" }),
    slug: t.varchar({ length: 48 }).notNull(),
    /** Kopecks, RUB. */
    amount: t.integer().notNull(),
    status: paymentStatus().notNull().default("pending"),
    /** Точка's `operationId`; set once the bank created the payment link. */
    externalId: t.varchar({ length: 64 }).unique(),
    /** The bank's payment page, while the order is pending. */
    confirmationUrl: t.text(),
    /**
     * After this the bank is asked whether the link ran out, and only then
     * the name is released: a pending order never just lapses, it may be paid.
     */
    holdUntil: t.timestamp({ withTimezone: true }).notNull(),
    paidAt: t.timestamp({ withTimezone: true }),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("slug_orders_user_status_idx").on(table.userId, table.status),
    uniqueIndex("slug_orders_pending_slug_idx")
      .on(table.slug)
      .where(sql`${table.status} = 'pending'`),
    check("slug_orders_positive", sql`${table.amount} > 0`),
  ],
);
