import {
  Booking,
  BookingSeries,
  CreditEntry,
  eq,
  isExclusionViolation,
  user,
} from "@synoro/db";
import { notifySeriesBooked } from "@synoro/jobs/booking-video";
import { z } from "zod";

import { adjustCredits, releaseExpiredHolds } from "../../lib/bookings";
import { exportBooking } from "../../lib/google-calendar";
import {
  findMembership,
  findPractice,
  practiceProcedure,
} from "../../lib/practice-access";
import { previewSeries, SERIES_MAX, seriesMember } from "../../lib/series";
import { seriesInput } from "./series-preview";

/**
 * Book a recurring consultation: the same local time every week or every
 * other week, `count` dates minus the ones in `skip`, at least two. All
 * bookings are made at once, in one transaction, one credit each.
 *
 * SLOT_UNAVAILABLE lists the dates that can't be booked (off the schedule,
 * taken, busy in Google for clients, past): skip them or pick another time.
 * It is also raised, with no dates, when someone took a date between the
 * check and the insert (`bookings_no_overlap`); nothing is booked then.
 * NO_CREDITS when the balance doesn't cover every booking. Access, the phone
 * and the Google check as in `book`.
 *
 * @example client.booking.bookSeries({ practiceId, startsAt, intervalWeeks: 1, count: 8 })
 */
export const bookSeries = practiceProcedure
  .errors({
    PHONE_REQUIRED: {
      message:
        "Укажите номер телефона в профиле — специалисту нужно связаться с вами",
    },
    NO_CREDITS: {
      message: "На балансе не хватает оплаченных занятий на все даты",
    },
    SLOT_UNAVAILABLE: {
      message:
        "Некоторые даты недоступны — уберите их или выберите другое время",
      data: z.object({ dates: z.array(z.date()) }),
    },
    TOO_FEW: { message: "Для повторной записи нужно хотя бы две даты" },
    NOT_FOUND: { message: "Клиент не найден в этой практике" },
  })
  .input(
    seriesInput.extend({
      /** Dates of the series left out on purpose. */
      skip: z.array(z.date()).max(SERIES_MAX).default([]),
      note: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ context, input, errors }) => {
    const userId = context.session.user.id;
    const [caller, practice] = await Promise.all([
      findMembership(context.db, input.practiceId, userId),
      findPractice(context.db, input.practiceId),
    ]);
    if (!caller || !practice) throw errors.FORBIDDEN();
    const who = await seriesMember(
      context.db,
      practice.id,
      caller,
      input.memberId,
    );
    if (who.error) throw errors[who.error]();
    const { member, staff, forOther } = who;
    // Staff booking a client reach them anyway; a client must leave a phone.
    if (!forOther) {
      const account = await context.db.query.user.findFirst({
        where: eq(user.id, userId),
        columns: { phone: true },
      });
      if (!account?.phone) throw errors.PHONE_REQUIRED();
    }

    const skipped = new Set(input.skip.map((d) => d.getTime()));
    const dates = (
      await previewSeries(context.db, practice, input, { checkGoogle: !staff })
    ).filter((d) => !skipped.has(d.startsAt.getTime()));
    if (dates.length < 2) throw errors.TOO_FEW();
    const blocked = dates.filter((d) => d.status !== "free");
    if (blocked.length > 0) {
      throw errors.SLOT_UNAVAILABLE({
        data: { dates: blocked.map((d) => d.startsAt) },
      });
    }

    await releaseExpiredHolds(context.db, practice.id);
    let created: { seriesId: string; bookingIds: string[]; credits: number };
    try {
      created = await context.db.transaction(async (tx) => {
        const credits = await adjustCredits(tx, member.id, -dates.length);
        if (credits === undefined) throw errors.NO_CREDITS();
        const [series] = await tx
          .insert(BookingSeries)
          .values({
            practiceId: practice.id,
            memberId: member.id,
            intervalWeeks: input.intervalWeeks,
            count: dates.length,
            createdById: userId,
          })
          .returning({ id: BookingSeries.id });
        if (!series) throw new Error("Failed to insert series");
        const bookings = await tx
          .insert(Booking)
          .values(
            dates.map((d) => ({
              practiceId: practice.id,
              kind: "consultation" as const,
              startsAt: d.startsAt,
              endsAt: d.endsAt,
              memberId: member.id,
              note: input.note,
              seriesId: series.id,
              createdById: userId,
            })),
          )
          .returning({ id: Booking.id });
        await tx.insert(CreditEntry).values(
          bookings.map((b) => ({
            memberId: member.id,
            delta: -1,
            reason: "booking" as const,
            bookingId: b.id,
            createdById: userId,
          })),
        );
        return {
          seriesId: series.id,
          bookingIds: bookings.map((b) => b.id),
          credits,
        };
      });
    } catch (error) {
      if (isExclusionViolation(error, "bookings_no_overlap")) {
        throw errors.SLOT_UNAVAILABLE({ data: { dates: [] }, cause: error });
      }
      throw error;
    }

    // After the commit: Google and mails never undo the bookings.
    for (const id of created.bookingIds) await exportBooking(context.db, id);
    await notifySeriesBooked(context.db, created.bookingIds);

    return {
      seriesId: created.seriesId,
      dates: dates.map((d) => d.startsAt),
      credits: created.credits,
    };
  });
