import { analyticsPeriodSchema } from "@synoro/validators";
import { z } from "zod";

import { hasPro } from "../../lib/billing";
import {
  findOwnerMembership,
  findPractice,
  practiceProcedure,
} from "../../lib/practice-access";
import { loadStats, periodStats, seriesStats, usableTimeZone } from "./stats";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How the practice is doing over the last 30, 90 or 365 days, next to the
 * same stretch before it: meetings, no-shows, online revenue, clients, the
 * busy hours. `report` is null while the owner has no «Про». Owner only —
 * the numbers include the practice's money.
 *
 * @example client.analytics.overview({ practiceId, days: 30 })
 */
export const overview = practiceProcedure
  .errors({
    FORBIDDEN: { message: "Аналитику видит владелец практики" },
  })
  .input(z.object({ practiceId: z.uuid(), days: analyticsPeriodSchema }))
  .handler(async ({ context, input, errors }) => {
    const owner = await findOwnerMembership(
      context.db,
      input.practiceId,
      context.session.user.id,
    );
    if (!owner) throw errors.FORBIDDEN();

    if (!(await hasPro(context.db, context.session.user.id))) {
      return { pro: false, report: null };
    }
    const practice = await findPractice(context.db, input.practiceId);
    if (!practice) throw errors.FORBIDDEN();

    const now = new Date();
    const timeZone = usableTimeZone(practice.timezone);
    const current = {
      from: new Date(now.getTime() - input.days * DAY_MS),
      to: now,
    };
    const before = {
      from: new Date(current.from.getTime() - input.days * DAY_MS),
      to: current.from,
    };
    const unit = input.days <= 30 ? ("day" as const) : ("week" as const);

    const [stats, previous, series, load] = await Promise.all([
      periodStats(context.db, input.practiceId, current, now),
      periodStats(context.db, input.practiceId, before, now),
      seriesStats(context.db, input.practiceId, current, now, timeZone, unit),
      loadStats(context.db, input.practiceId, current, now, timeZone),
    ]);

    return {
      pro: true,
      report: {
        days: input.days,
        timeZone,
        stats,
        previous,
        series: { unit, points: series },
        load,
      },
    };
  });
