import { env } from "@synoro/config";
import { and, count, DataExport, eq, gt, inArray, Practice } from "@synoro/db";
import { dispatchDataExport } from "@synoro/jobs";
import { recordDataAudit } from "@synoro/jobs/data-export";

import { dataProcedure, hasFreshAccess } from "../../lib/data-access";

/** Generous for a person; a brake on someone who got into the account. */
const FULL_EXPORTS_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ask for the archive of everything: built in the background, the link comes
 * by mail. On any plan, always. An archive still being built is not started
 * twice.
 *
 * @example client.data.startExport()
 */
export const startExport = dataProcedure
  .errors({
    NO_PRACTICE: { message: "В аккаунте нет своей практики: выгружать нечего" },
    TOO_MANY_EXPORTS: {
      message: `Не больше ${FULL_EXPORTS_PER_DAY} архивов в сутки. Прошлые ещё можно скачать`,
    },
    STORAGE_UNAVAILABLE: {
      message: "Хранилище файлов сейчас недоступно. Попробуйте позже",
    },
  })
  .handler(async ({ context, errors }) => {
    const { session, user } = context.session;
    if (!(await hasFreshAccess(context.db, session.id))) {
      throw errors.ACCESS_REQUIRED();
    }

    const [owned, running, today] = await Promise.all([
      context.db.query.Practice.findFirst({
        where: eq(Practice.ownerId, user.id),
        columns: { id: true },
      }),
      context.db.query.DataExport.findFirst({
        where: and(
          eq(DataExport.userId, user.id),
          eq(DataExport.kind, "full"),
          inArray(DataExport.status, ["pending", "running"]),
        ),
        columns: { id: true },
      }),
      context.db
        .select({ value: count() })
        .from(DataExport)
        .where(
          and(
            eq(DataExport.userId, user.id),
            eq(DataExport.kind, "full"),
            gt(DataExport.createdAt, new Date(Date.now() - DAY_MS)),
          ),
        ),
    ]);
    if (!owned) throw errors.NO_PRACTICE();
    if (running) return { id: running.id };
    if ((today[0]?.value ?? 0) >= FULL_EXPORTS_PER_DAY) {
      throw errors.TOO_MANY_EXPORTS();
    }
    if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      throw errors.STORAGE_UNAVAILABLE();
    }

    const [row] = await context.db
      .insert(DataExport)
      .values({ userId: user.id, kind: "full" })
      .returning({ id: DataExport.id });
    if (!row) throw new Error("Failed to insert data export");

    await recordDataAudit(context.db, {
      userId: user.id,
      actorId: user.id,
      action: "export_requested",
      details: { kind: "full" },
    });
    await dispatchDataExport(row.id);
    return { id: row.id };
  });
