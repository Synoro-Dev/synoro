import { sql } from "drizzle-orm";
import { check, pgTable, unique } from "drizzle-orm/pg-core";

import { Practice } from "../booking/practice";

/**
 * What a client can buy online: `credits` consultations for `price`
 * (kopecks). One package per size, e.g. 1 × 3 000 ₽ and 5 × 14 000 ₽.
 */
export const PaymentPackage = pgTable(
  "payment_packages",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    practiceId: t
      .uuid()
      .notNull()
      .references(() => Practice.id, { onDelete: "cascade" }),
    credits: t.integer().notNull(),
    price: t.integer().notNull(),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (table) => [
    unique("payment_packages_practice_credits_unique").on(
      table.practiceId,
      table.credits,
    ),
    check(
      "payment_packages_credits_range",
      sql`${table.credits} between 1 and 100`,
    ),
    check("payment_packages_price_positive", sql`${table.price} > 0`),
  ],
);
