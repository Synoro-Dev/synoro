import { env, logger, paths } from "@synoro/config";
import {
  and,
  ClientBackup,
  type DataAuditAction,
  DataAuditEntry,
  type Database,
  DataExport,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  or,
  Practice,
  sql,
} from "@synoro/db";

import { dispatchEmail } from "../index";
import { collectAccount, DATA_FORMAT_VERSION } from "./collect";
import { clientsArchive, fullArchive } from "./files";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** How long an archive's link works; the file is deleted after that. */
export const EXPORT_LINK_DAYS = 7;
/** A task that hasn't finished by then is not going to. */
const STUCK_AFTER_MS = HOUR_MS;
/** The privacy policy: security logs live no longer than 12 months. */
const AUDIT_KEEP_MS = 365 * DAY_MS;
const MAX_BATCH = 200;

/** What leaves the process: replaced in tests. */
export interface ExportDeps {
  store(key: string, body: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
  sendReady(message: {
    to: string;
    kind: "full" | "weekly";
    expiresOn: string;
  }): Promise<void>;
}

/** The bucket throws at import without credentials, so it loads only here. */
export const defaultExportDeps: ExportDeps = {
  async store(key, body) {
    const { uploadBufferToS3 } = await import("@synoro/storage");
    await uploadBufferToS3(key, body, "application/zip");
  },
  async remove(key) {
    const { deleteObjectFromS3 } = await import("@synoro/storage");
    await deleteObjectFromS3(key);
  },
  async sendReady({ to, kind, expiresOn }) {
    await dispatchEmail({
      template: "data-export-ready",
      to: [to],
      subject:
        kind === "weekly"
          ? "Копия базы клиентов готова"
          : "Архив с вашими данными готов",
      props: {
        kind,
        expiresOn,
        url: new URL(paths.settings.data, env.APP_URL).href,
      },
    });
  },
};

export async function recordDataAudit(
  db: Database,
  entry: {
    userId: string;
    actorId: string | null;
    practiceId?: string | null;
    action: DataAuditAction;
    details?: Record<string, string | number | boolean | null>;
  },
) {
  await db.insert(DataAuditEntry).values({
    userId: entry.userId,
    actorId: entry.actorId,
    practiceId: entry.practiceId ?? null,
    action: entry.action,
    details: entry.details ?? {},
  });
}

/**
 * Build one archive, put it in the bucket, mail the link. A retry after a
 * failure starts over; the mail goes out only once the file is there.
 */
export async function runDataExport(
  db: Database,
  exportId: string,
  deps: ExportDeps = defaultExportDeps,
  now = new Date(),
) {
  const [row] = await db
    .update(DataExport)
    .set({ status: "running" })
    .where(
      and(
        eq(DataExport.id, exportId),
        inArray(DataExport.status, ["pending", "running", "failed"]),
      ),
    )
    .returning();
  if (!row) return;

  try {
    const dump = await collectAccount(db, row.userId, now);
    const archive =
      row.kind === "weekly" ? clientsArchive(dump) : fullArchive(dump, now);
    const key = `exports/${row.userId}/${row.id}.zip`;
    await deps.store(key, archive);

    const expiresAt = new Date(now.getTime() + EXPORT_LINK_DAYS * DAY_MS);
    await db
      .update(DataExport)
      .set({
        status: "ready",
        fileKey: key,
        sizeBytes: archive.length,
        formatVersion: DATA_FORMAT_VERSION,
        expiresAt,
      })
      .where(eq(DataExport.id, row.id));

    // The archive is there and shown in the settings even if the mail fails.
    await deps
      .sendReady({
        to: dump.account.email,
        kind: row.kind,
        expiresOn: new Intl.DateTimeFormat("ru-RU", {
          timeZone: dump.practices[0]?.timezone ?? "Europe/Moscow",
          day: "numeric",
          month: "long",
        }).format(expiresAt),
      })
      .catch((error: unknown) =>
        logger.warn("data_export.mail_failed", {
          exportId: row.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
  } catch (error) {
    await db
      .update(DataExport)
      .set({ status: "failed" })
      .where(eq(DataExport.id, row.id));
    throw error;
  }
}

/**
 * Delete archives whose link ran out, give up on stuck tasks and drop journal
 * lines past their term. Hourly; a file that fails to go stays due and is
 * tried again.
 */
export async function cleanupDataExports(
  db: Database,
  deps: Pick<ExportDeps, "remove"> = defaultExportDeps,
  now = new Date(),
) {
  const expired = await db
    .select({ id: DataExport.id, fileKey: DataExport.fileKey })
    .from(DataExport)
    .where(and(eq(DataExport.status, "ready"), lte(DataExport.expiresAt, now)))
    .limit(MAX_BATCH);

  let removed = 0;
  for (const row of expired) {
    try {
      if (row.fileKey) await deps.remove(row.fileKey);
      await db
        .update(DataExport)
        .set({ status: "expired", fileKey: null })
        .where(eq(DataExport.id, row.id));
      removed++;
    } catch (error) {
      logger.warn("data_export.cleanup_failed", {
        exportId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await db
    .update(DataExport)
    .set({ status: "failed" })
    .where(
      and(
        inArray(DataExport.status, ["pending", "running"]),
        lt(DataExport.createdAt, new Date(now.getTime() - STUCK_AFTER_MS)),
      ),
    );

  await db
    .delete(DataAuditEntry)
    .where(
      lt(DataAuditEntry.createdAt, new Date(now.getTime() - AUDIT_KEEP_MS)),
    );

  return { removed };
}

/**
 * The weekly copies. A run reaches everyone not served in the last six days,
 * so a cron run missed by a day doesn't send two copies or skip a week.
 */
export async function runClientBackups(
  db: Database,
  deps: ExportDeps = defaultExportDeps,
  now = new Date(),
) {
  const due = await db
    .select({ userId: ClientBackup.userId })
    .from(ClientBackup)
    .where(
      and(
        or(
          isNull(ClientBackup.lastRunAt),
          lt(ClientBackup.lastRunAt, new Date(now.getTime() - 6 * DAY_MS)),
        ),
        sql`exists (select 1 from ${Practice} where ${Practice.ownerId} = ${ClientBackup.userId})`,
      ),
    )
    .limit(MAX_BATCH);

  let made = 0;
  for (const { userId } of due) {
    try {
      const [row] = await db
        .insert(DataExport)
        .values({ userId, kind: "weekly" })
        .returning({ id: DataExport.id });
      if (!row) continue;
      await runDataExport(db, row.id, deps, now);
      await db
        .update(ClientBackup)
        .set({ lastRunAt: now })
        .where(eq(ClientBackup.userId, userId));
      await recordDataAudit(db, {
        userId,
        actorId: null,
        action: "export_requested",
        details: { kind: "weekly" },
      });
      made++;
    } catch (error) {
      logger.warn("data_export.backup_failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { made };
}
