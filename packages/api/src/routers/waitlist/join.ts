import {
  and,
  count,
  eq,
  gte,
  isNull,
  PracticeMember,
  user,
  WaitlistEntry,
} from "@synoro/db";
import { WAITLIST_MAX_ENTRIES, waitlistJoinSchema } from "@synoro/validators";
import { z } from "zod";

import { track } from "../../lib/analytics";
import { findOrCreateGuestMember } from "../../lib/guests";
import {
  findMembership,
  findPractice,
  isStaff,
} from "../../lib/practice-access";
import { toZonedDate } from "../../lib/schedule";
import { resolveService } from "../../lib/services";
import { publicProcedure } from "../../orpc";

/**
 * Leave a wish on the practice's waiting list: dates, optionally hours and a
 * service. When matching time frees up (a cancelled or moved booking) the
 * person is told once, by mail or messenger, and books it on the page — the
 * time is not held for them.
 *
 * A signed-in client uses their own account; a visitor leaves name, phone and
 * email, as when booking, and gets a passive account (see
 * `findOrCreateGuestMember`). SIGN_IN_REQUIRED for the email of the practice's
 * own staff, STAFF for staff signed in; DATES_PAST when the whole range is over;
 * TOO_MANY when the person already has three open wishes here.
 *
 * @example client.waitlist.join({ practiceId, fromDate: "2026-11-09", toDate: "2026-11-15", fromMinute: 1080, toMinute: null, name: "Иван", phone: "+7 900 000-00-00", email: "ivan@example.com" })
 */
export const join = publicProcedure
  .errors({
    NOT_FOUND: { message: "Практика не найдена — обновите страницу" },
    SERVICE_NOT_FOUND: { message: "Услуга не найдена — обновите страницу" },
    DATES_PAST: { message: "Эти даты уже прошли — выберите другие" },
    STAFF: {
      message: "Вы ведёте эту практику: лист ожидания нужен её клиентам",
    },
    SIGN_IN_REQUIRED: {
      message: "Эта почта принадлежит специалисту практики — войдите в аккаунт",
    },
    TOO_MANY: {
      message: `Одновременно можно ждать не больше ${WAITLIST_MAX_ENTRIES} раз — удалите лишнее`,
    },
  })
  .input(waitlistJoinSchema.and(z.object({ practiceId: z.uuid() })))
  .handler(async ({ context, input, errors }) => {
    const practice = await findPractice(context.db, input.practiceId);
    if (!practice) throw errors.NOT_FOUND();

    const today = toZonedDate(new Date(), practice.timezone);
    if (input.toDate < today) throw errors.DATES_PAST();

    // A wish without a service is for the practice's first one (`serviceId`
    // stays null so it follows if the owner reorders them).
    if (input.serviceId) {
      const service = await resolveService(
        context.db,
        practice.id,
        input.serviceId,
      );
      if (!service) throw errors.SERVICE_NOT_FOUND();
    }

    let userId: string;
    const session = context.session;
    if (session) {
      userId = session.user.id;
      const member = await findMembership(context.db, practice.id, userId);
      if (member && isStaff(member.role)) throw errors.STAFF();
      const account = await context.db.query.user.findFirst({
        where: eq(user.id, userId),
        columns: { phone: true },
      });
      if (!account?.phone) {
        await context.db
          .update(user)
          .set({ phone: input.phone })
          .where(eq(user.id, userId));
      }
      await context.db
        .insert(PracticeMember)
        .values({ practiceId: practice.id, userId, role: "client" })
        .onConflictDoNothing();
    } else {
      const guest = await findOrCreateGuestMember(
        context.db,
        practice.id,
        input,
      );
      if (guest.staff) throw errors.SIGN_IN_REQUIRED();
      userId = guest.user.id;
    }

    const [open] = await context.db
      .select({ entries: count() })
      .from(WaitlistEntry)
      .where(
        and(
          eq(WaitlistEntry.practiceId, practice.id),
          eq(WaitlistEntry.userId, userId),
          isNull(WaitlistEntry.notifiedAt),
          gte(WaitlistEntry.toDate, today),
        ),
      );
    if ((open?.entries ?? 0) >= WAITLIST_MAX_ENTRIES) throw errors.TOO_MANY();

    // A wish never starts in the past.
    let startDate = input.fromDate;
    if (startDate < today) startDate = today;

    const [entry] = await context.db
      .insert(WaitlistEntry)
      .values({
        practiceId: practice.id,
        userId,
        serviceId: input.serviceId ?? null,
        fromDate: startDate,
        toDate: input.toDate,
        fromMinute: input.fromMinute,
        toMinute: input.toMinute,
      })
      .returning({ id: WaitlistEntry.id });
    if (!entry) throw new Error("Failed to insert waitlist entry");

    track("waitlist_joined", userId, {
      practiceId: practice.id,
      serviceId: input.serviceId ?? null,
    });
    return { id: entry.id };
  });
