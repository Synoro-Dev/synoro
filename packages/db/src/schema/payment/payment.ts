import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable, unique } from "drizzle-orm/pg-core";

import { user } from "../auth/user";
import { Practice, PracticeMember } from "../booking/practice";
import { PaymentAccount, paymentProvider } from "./account";

/**
 * pending   — created, the client hasn't paid (or the provider hasn't said).
 * succeeded — paid: the credits are on the member's balance.
 * canceled  — declined, expired or abandoned; nothing was charged.
 */
export const paymentStatus = pgEnum("payment_status", [
  "pending",
  "succeeded",
  "canceled",
]);

/**
 * A client's top-up of their consultation balance through the practice's
 * merchant account. The provider is the source of truth for the status;
 * the move to `succeeded` and the credit happen in one statement, once.
 */
export const Payment = pgTable(
  "payments",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    practiceId: t
      .uuid()
      .notNull()
      .references(() => Practice.id, { onDelete: "cascade" }),
    accountId: t
      .uuid()
      .notNull()
      .references(() => PaymentAccount.id, { onDelete: "cascade" }),
    memberId: t
      .uuid()
      .references(() => PracticeMember.id, { onDelete: "set null" }),
    provider: paymentProvider().notNull(),
    /** The provider's payment id; set once it accepted the payment. */
    externalId: t.varchar({ length: 64 }),
    status: paymentStatus().notNull().default("pending"),
    /** Consultations added to the balance on success. */
    credits: t.integer().notNull(),
    /** Kopecks, RUB. */
    amount: t.integer().notNull(),
    /** The provider's payment page, while the payment is pending. */
    confirmationUrl: t.text(),
    createdById: t.text().references(() => user.id, { onDelete: "set null" }),
    paidAt: t.timestamp({ withTimezone: true }),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    unique("payments_provider_external_unique").on(
      table.provider,
      table.externalId,
    ),
    index("payments_practice_created_idx").on(
      table.practiceId,
      table.createdAt,
    ),
    index("payments_member_idx").on(table.memberId),
    check(
      "payments_positive",
      sql`${table.credits} > 0 and ${table.amount} > 0`,
    ),
  ],
);

export type PaymentStatus = (typeof paymentStatus.enumValues)[number];
