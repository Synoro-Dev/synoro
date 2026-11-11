import { and, Booking, eq, ImportBatch, isNotNull } from "@synoro/db";
import { saveImportFile } from "@synoro/jobs/data-import";
import {
  findConnection,
  listEvents,
  withGoogle,
} from "@synoro/jobs/google-calendar";
import { z } from "zod";

import { dataProcedure, findOwnedPractice } from "../../lib/data-access";

const YEAR_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * Take the future events of the linked Google Calendar as a draft, the same
 * as an uploaded calendar. Events Synoro put there itself are left out, or every
 * booking would come back as its own double.
 *
 * @example client.import.fromGoogle({ practiceId })
 */
export const fromGoogle = dataProcedure
  .errors({
    NOT_CONNECTED: { message: "Google Календарь не подключён к этой практике" },
    PROVIDER_ERROR: {
      message: "Google Календарь не ответил. Попробуйте позже",
    },
  })
  .input(z.object({ practiceId: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const { user } = context.session;
    const practice = await findOwnedPractice(
      context.db,
      input.practiceId,
      user.id,
    );
    if (!practice) throw errors.FORBIDDEN();
    const connection = await findConnection(context.db, practice.id);
    if (!connection) throw errors.NOT_CONNECTED();

    const now = new Date();
    const [listed, mirrored] = await Promise.all([
      withGoogle(context.db, connection, (token) =>
        listEvents(
          token,
          connection.eventsCalendarId,
          now,
          new Date(now.getTime() + YEAR_MS),
        ),
      ).catch(() => null),
      context.db
        .select({ id: Booking.googleEventId })
        .from(Booking)
        .where(
          and(
            eq(Booking.practiceId, practice.id),
            isNotNull(Booking.googleEventId),
          ),
        ),
    ]);
    if (!listed) throw errors.PROVIDER_ERROR();

    const ours = new Set(mirrored.map((row) => row.id));
    const events = listed
      .filter((event) => !ours.has(event.id))
      .map(({ id: _, ...event }) => event);

    const [batch] = await context.db
      .insert(ImportBatch)
      .values({
        practiceId: practice.id,
        createdById: user.id,
        source: "calendar",
        fileName: "Google Календарь",
        rowCount: events.length,
      })
      .returning({ id: ImportBatch.id });
    if (!batch) throw new Error("Failed to insert import batch");
    await saveImportFile(
      context.db,
      batch.id,
      new TextEncoder().encode(JSON.stringify({ events })),
    );
    return { kind: "calendar" as const, id: batch.id, events: events.length };
  });
