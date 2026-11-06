import { z } from "zod";

import {
  findMembership,
  findPractice,
  practiceProcedure,
} from "../../lib/practice-access";
import { previewSeries, SERIES_MAX, seriesMember } from "../../lib/series";
import { resolveService } from "../../lib/services";

export const seriesInput = z.object({
  practiceId: z.uuid(),
  /** The first booking; the rest follow at the same local time. */
  startsAt: z.date(),
  intervalWeeks: z.union([z.literal(1), z.literal(2)]),
  count: z.number().int().min(2).max(SERIES_MAX),
  /** What to book; the practice's first service when missing. */
  serviceId: z.uuid().optional(),
  /** Staff only: the client to book; defaults to the caller. */
  memberId: z.uuid().optional(),
});

/**
 * The dates a recurring booking would take, each with whether it can be
 * booked (`free`) or why not, the client's balance and what one booking
 * costs (`price`, in credits). `booking.slots`
 * covers 35 days at most; a series of 12 every other week spans almost six
 * months.
 *
 * @example client.booking.seriesPreview({ practiceId, startsAt, intervalWeeks: 1, count: 8 })
 */
export const seriesPreview = practiceProcedure
  .errors({
    NOT_FOUND: { message: "Клиент не найден в этой практике" },
    SERVICE_NOT_FOUND: { message: "Услуга не найдена — обновите страницу" },
  })
  .input(seriesInput)
  .handler(async ({ context, input, errors }) => {
    const [caller, practice] = await Promise.all([
      findMembership(context.db, input.practiceId, context.session.user.id),
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

    const service = await resolveService(
      context.db,
      practice.id,
      input.serviceId,
    );
    if (!service) throw errors.SERVICE_NOT_FOUND();

    const dates = await previewSeries(
      context.db,
      practice,
      { ...input, minutes: service.minutes },
      { checkGoogle: !who.staff },
    );
    return { dates, credits: who.member.credits, price: service.credits };
  });
