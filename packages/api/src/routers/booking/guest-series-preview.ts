import { findOpenPractice } from "../../lib/practice-access";
import { previewSeries } from "../../lib/series";
import { resolveService } from "../../lib/services";
import { publicProcedure } from "../../orpc";
import { seriesInput } from "./series-preview";

/**
 * The dates a visitor's recurring booking would take, each with whether it can
 * be booked (`free`) or why not — `seriesPreview` for someone who has no
 * account yet. `price` is what one booking costs, in credits: the package the
 * visitor pays for must cover every date.
 *
 * @example client.booking.guestSeriesPreview({ practiceId, startsAt, intervalWeeks: 1, count: 8 })
 */
export const guestSeriesPreview = publicProcedure
  .errors({
    NOT_FOUND: { message: "Практика не найдена — обновите страницу" },
    SERVICE_NOT_FOUND: { message: "Услуга не найдена — обновите страницу" },
  })
  .input(seriesInput.omit({ memberId: true }))
  .handler(async ({ context, input, errors }) => {
    const practice = await findOpenPractice(context.db, input.practiceId);
    if (!practice) throw errors.NOT_FOUND();
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
      { checkGoogle: true },
    );
    return { dates, price: service.credits };
  });
