import { sql } from "drizzle-orm";
import { pgEnum, pgTable, unique, uniqueIndex } from "drizzle-orm/pg-core";

import { Practice } from "../booking/practice";

/**
 * yookassa — ЮKassa: `merchantId` is the shopId, the secret its API key.
 * tbank    — Т-Банк эквайринг: `merchantId` is the TerminalKey, the secret
 *            the terminal password.
 */
export const paymentProvider = pgEnum("payment_provider", [
  "yookassa",
  "tbank",
]);

/**
 * Taxation system printed on 54-ФЗ receipts. ЮKassa takes it as
 * `tax_system_code` 1–6, Т-Банк as `Receipt.Taxation`.
 */
export const taxSystem = pgEnum("payment_tax_system", [
  "osn",
  "usn_income",
  "usn_income_outcome",
  "esn",
  "patent",
]);

/**
 * The specialist's own merchant account: clients pay the practice directly,
 * money never passes through the platform. One active account per practice;
 * a replaced or disconnected one stays (inactive) so payments started with
 * it can still be checked.
 */
export const PaymentAccount = pgTable(
  "payment_accounts",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    practiceId: t
      .uuid()
      .notNull()
      .references(() => Practice.id, { onDelete: "cascade" }),
    provider: paymentProvider().notNull(),
    merchantId: t.varchar({ length: 64 }).notNull(),
    /** AES-256-GCM, see `@synoro/api` payments/secrets. Never sent to clients. */
    secret: t.text().notNull(),
    /** A demo shop / test terminal: no real money moves. */
    test: t.boolean().notNull().default(false),
    active: t.boolean().notNull().default(true),
    /** Send a 54-ФЗ receipt with each payment (online cash register set up). */
    receipts: t.boolean().notNull().default(false),
    taxSystem: taxSystem(),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    unique("payment_accounts_practice_provider_unique").on(
      table.practiceId,
      table.provider,
    ),
    uniqueIndex("payment_accounts_one_active_idx")
      .on(table.practiceId)
      .where(sql`${table.active}`),
  ],
);

export type PaymentProvider = (typeof paymentProvider.enumValues)[number];
export type TaxSystem = (typeof taxSystem.enumValues)[number];
