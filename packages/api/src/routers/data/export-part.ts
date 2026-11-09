import { and, count, DataAuditEntry, eq, gt } from "@synoro/db";
import {
  appointmentsCsv,
  clientsCsv,
  collectPractice,
  incomeCsv,
  recordDataAudit,
} from "@synoro/jobs/data-export";
import { z } from "zod";

import {
  dataProcedure,
  findOwnedPractice,
  hasFreshAccess,
} from "../../lib/data-access";

const PARTIAL_EXPORTS_PER_DAY = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const period = <T extends "appointments" | "income">(what: T) =>
  z
    .object({
      what: z.literal(what),
      practiceId: z.uuid(),
      from: z.date(),
      to: z.date(),
    })
    .refine((range) => range.from < range.to, {
      message: "Начало периода должно быть раньше конца",
    });

const input = z.discriminatedUnion("what", [
  z.object({ what: z.literal("clients"), practiceId: z.uuid() }),
  period("appointments"),
  period("income"),
]);

/**
 * One table from a list: all the clients, the bookings of a period, or the
 * income of a period (online and outside Synoro, for the tax return). A CSV
 * returned as text, the browser saves it. The whole client base is the same
 * data as in the archive, so it asks for the same confirmation.
 *
 * @example client.data.exportPart({ what: "clients", practiceId })
 */
export const exportPart = dataProcedure
  .errors({
    TOO_MANY_EXPORTS: {
      message: `Не больше ${PARTIAL_EXPORTS_PER_DAY} выгрузок в сутки. Попробуйте завтра`,
    },
  })
  .input(input)
  .handler(async ({ context, input, errors }) => {
    const { session, user } = context.session;
    const owned = await findOwnedPractice(
      context.db,
      input.practiceId,
      user.id,
    );
    if (!owned) throw errors.FORBIDDEN();
    if (!(await hasFreshAccess(context.db, session.id))) {
      throw errors.ACCESS_REQUIRED();
    }

    const [today] = await context.db
      .select({ value: count() })
      .from(DataAuditEntry)
      .where(
        and(
          eq(DataAuditEntry.userId, user.id),
          eq(DataAuditEntry.action, "partial_export"),
          gt(DataAuditEntry.createdAt, new Date(Date.now() - DAY_MS)),
        ),
      );
    if ((today?.value ?? 0) >= PARTIAL_EXPORTS_PER_DAY) {
      throw errors.TOO_MANY_EXPORTS();
    }

    const practice = await collectPractice(context.db, owned.id);
    const csv =
      input.what === "clients"
        ? clientsCsv([practice])
        : input.what === "income"
          ? incomeCsv(practice, input.from, input.to)
          : appointmentsCsv([
              {
                ...practice,
                bookings: practice.bookings.filter((booking) => {
                  const at = new Date(booking.starts_at);
                  return at >= input.from && at < input.to;
                }),
              },
            ]);

    await recordDataAudit(context.db, {
      userId: user.id,
      actorId: user.id,
      practiceId: owned.id,
      action: "partial_export",
      details: { what: input.what },
    });
    return { csv, filename: `${input.what}-${owned.slug}.csv` };
  });
