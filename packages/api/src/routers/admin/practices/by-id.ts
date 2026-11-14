import {
  AvailabilityRule,
  and,
  asc,
  count,
  eq,
  GoogleCalendarConnection,
  inArray,
  Practice,
  PracticeDomain,
  PracticeMember,
  PracticeSlugAlias,
  Service,
  user,
  Workflow,
} from "@synoro/db";
import { z } from "zod";

import { findSubscription, planOf } from "../../../lib/billing";
import { practiceImageAbsoluteUrl } from "../../../lib/urls";
import { adminProcedure } from "../../../orpc";

/**
 * One practice's card for the admin site: everything its owner configured —
 * the booking page's settings (hours, services, questionnaire, look,
 * cancellation and notification rules), its address and domain, the linked
 * Google Calendar, own message rules, and who belongs to it.
 *
 * Throws NOT_FOUND when no practice matches the given id.
 */
export const byId = adminProcedure
  .errors({ NOT_FOUND: { message: "Практика не найдена" } })
  .input(z.object({ id: z.uuid() }))
  .handler(async ({ context, input, errors }) => {
    const [found] = await context.db
      .select({
        practice: Practice,
        owner: { id: user.id, name: user.name, email: user.email },
      })
      .from(Practice)
      .innerJoin(user, eq(user.id, Practice.ownerId))
      .where(eq(Practice.id, input.id));

    if (!found) {
      throw errors.NOT_FOUND();
    }

    const { practice, owner } = found;
    const [
      subscription,
      formerSlugs,
      domain,
      googleCalendar,
      services,
      availability,
      workflows,
      staff,
      clients,
    ] = await Promise.all([
      findSubscription(context.db, owner.id),
      context.db.query.PracticeSlugAlias.findMany({
        where: eq(PracticeSlugAlias.practiceId, practice.id),
        columns: { slug: true },
        orderBy: asc(PracticeSlugAlias.createdAt),
      }),
      context.db.query.PracticeDomain.findFirst({
        where: eq(PracticeDomain.practiceId, practice.id),
        columns: {
          hostname: true,
          status: true,
          verifiedAt: true,
          securedAt: true,
          createdAt: true,
        },
      }),
      context.db.query.GoogleCalendarConnection.findFirst({
        where: eq(GoogleCalendarConnection.practiceId, practice.id),
        columns: {
          email: true,
          exportBookings: true,
          lastError: true,
          lastErrorAt: true,
          createdAt: true,
        },
      }),
      context.db
        .select({
          id: Service.id,
          name: Service.name,
          minutes: Service.minutes,
          credits: Service.credits,
          position: Service.position,
          active: Service.active,
          archived: Service.archived,
        })
        .from(Service)
        .where(eq(Service.practiceId, practice.id))
        .orderBy(asc(Service.position), asc(Service.createdAt)),
      context.db
        .select({
          weekday: AvailabilityRule.weekday,
          startMinute: AvailabilityRule.startMinute,
          endMinute: AvailabilityRule.endMinute,
        })
        .from(AvailabilityRule)
        .where(eq(AvailabilityRule.practiceId, practice.id))
        .orderBy(
          asc(AvailabilityRule.weekday),
          asc(AvailabilityRule.startMinute),
        ),
      context.db
        .select({
          id: Workflow.id,
          trigger: Workflow.trigger,
          amount: Workflow.amount,
          subject: Workflow.subject,
          text: Workflow.text,
          active: Workflow.active,
        })
        .from(Workflow)
        .where(eq(Workflow.practiceId, practice.id))
        .orderBy(asc(Workflow.createdAt), asc(Workflow.id)),
      context.db
        .select({
          userId: PracticeMember.userId,
          id: PracticeMember.id,
          role: PracticeMember.role,
          joinedAt: PracticeMember.createdAt,
          name: user.name,
          email: user.email,
        })
        .from(PracticeMember)
        .innerJoin(user, eq(user.id, PracticeMember.userId))
        .where(
          and(
            eq(PracticeMember.practiceId, practice.id),
            inArray(PracticeMember.role, ["owner", "admin"]),
          ),
        )
        .orderBy(asc(PracticeMember.createdAt)),
      context.db
        .select({ value: count() })
        .from(PracticeMember)
        .where(
          and(
            eq(PracticeMember.practiceId, practice.id),
            eq(PracticeMember.role, "client"),
          ),
        ),
    ]);

    const { image, ...info } = practice;
    return {
      practice: {
        ...info,
        imageUrl: practiceImageAbsoluteUrl(practice.slug, image),
      },
      owner: found.owner,
      plan: planOf(subscription),
      formerSlugs: formerSlugs.map((former) => former.slug),
      domain: domain ?? null,
      googleCalendar: googleCalendar ?? null,
      services,
      availability,
      workflows,
      staff,
      clients: clients[0]?.value ?? 0,
    };
  });
