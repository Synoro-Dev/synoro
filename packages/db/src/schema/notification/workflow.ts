import { sql } from "drizzle-orm";
import { check, index, pgEnum, pgTable } from "drizzle-orm/pg-core";

import { Practice } from "../booking/practice";

/**
 * after_end   — `amount` hours after a meeting ended;
 * low_balance — a booking left the client with `amount` meetings or fewer;
 * inactive    — a client's last meeting ended `amount` days ago.
 *
 * Keep in sync with `WORKFLOW_TRIGGERS` in `@synoro/validators`.
 */
export const workflowTrigger = pgEnum("workflow_trigger", [
  "after_end",
  "low_balance",
  "inactive",
]);

/**
 * A specialist's own message to clients («Про»): when it goes out and what
 * it says. The text may use `{имя}`-style placeholders (see
 * `WORKFLOW_VARIABLES` in `@synoro/validators`). The worker sends it by mail
 * (`@synoro/jobs/workflow-messages`) while the practice owner has «Про»;
 * what went to whom is kept in `sent_notices` under `wf:<id>:…`.
 */
export const Workflow = pgTable(
  "workflows",
  (t) => ({
    id: t.uuid().notNull().primaryKey().defaultRandom(),
    practiceId: t
      .uuid()
      .notNull()
      .references(() => Practice.id, { onDelete: "cascade" }),
    trigger: workflowTrigger().notNull(),
    /** Hours, meetings left or days, by `trigger`; the range is checked. */
    amount: t.smallint().notNull(),
    subject: t.varchar({ length: 120 }).notNull(),
    text: t.varchar({ length: 1000 }).notNull(),
    active: t.boolean().notNull().default(true),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .$onUpdateFn(() => sql`now()`),
  }),
  (table) => [
    index("workflows_practice_idx").on(table.practiceId),
    check(
      "workflows_amount_range",
      sql`(${table.trigger} = 'after_end' and ${table.amount} between 1 and 72)
        or (${table.trigger} = 'low_balance' and ${table.amount} between 0 and 5)
        or (${table.trigger} = 'inactive' and ${table.amount} between 7 and 180)`,
    ),
  ],
);

export type WorkflowRow = typeof Workflow.$inferSelect;
