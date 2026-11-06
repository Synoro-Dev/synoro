import { eq, Practice } from "@synoro/db";
import {
  analyzeEvents,
  loadBusy,
  loadImportFile,
  readEvents,
} from "@synoro/jobs/data-import";
import { z } from "zod";

import { dataProcedure } from "../../lib/data-access";
import { findOwnedBatch } from "../../lib/imports";

const SAMPLES = 50;

/**
 * What a calendar would become, before anything is written: how many events go
 * in, which clash with what's already booked, and what's left out.
 *
 * @example client.import.previewEvents({ batchId, eventsAs: "bookings" })
 */
export const previewEvents = dataProcedure
  .errors({
    NOT_FOUND: { message: "Загрузка не найдена или её срок вышел" },
  })
  .input(
    z.object({ batchId: z.uuid(), eventsAs: z.enum(["bookings", "blocked"]) }),
  )
  .handler(async ({ context, input, errors }) => {
    const { user } = context.session;
    const batch = await findOwnedBatch(context.db, input.batchId, user.id);
    const file = batch && (await loadImportFile(context.db, batch.id));
    if (!batch || !file) throw errors.NOT_FOUND();

    const practice = await context.db.query.Practice.findFirst({
      where: eq(Practice.id, batch.practiceId),
      columns: { timezone: true },
    });
    const now = new Date();
    const results = analyzeEvents(
      readEvents(file, practice?.timezone ?? "Europe/Moscow", now),
      await loadBusy(context.db, batch.practiceId, now),
      input.eventsAs,
      now,
    );
    const count = (status: (typeof results)[number]["status"]) =>
      results.filter((row) => row.status === status).length;

    return {
      added: count("new"),
      past: count("past"),
      allDay: count("all-day"),
      tooLong: count("too-long"),
      partial: results.filter((row) => row.partial).length,
      conflicts: {
        total: count("conflict"),
        samples: results
          .filter((row) => row.status === "conflict")
          .slice(0, SAMPLES)
          .map((row) => ({ title: row.title, startsAt: row.startsAt })),
      },
      samples: results
        .filter((row) => row.status === "new")
        .slice(0, 5)
        .map((row) => ({
          title: row.title,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
        })),
    };
  });
