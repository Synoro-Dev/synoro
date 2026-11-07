import { logger } from "@synoro/config";
import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  PracticeMember,
  user,
  WaitlistEntry,
} from "@synoro/db";
import {
  WAITLIST_CONFIRM_HOURS,
  WAITLIST_MAX_DAYS,
  WAITLIST_MAX_ENTRIES,
  WAITLIST_MAX_PENDING,
  waitlistGuestSchema,
  waitlistJoinSchema,
} from "@synoro/validators";
import { z } from "zod";

import { track } from "../../lib/analytics";
import {
  findOrCreateGuestAccount,
  hashGuestToken,
  newGuestToken,
} from "../../lib/guests";
import {
  findMembership,
  findOpenPractice,
  isStaff,
} from "../../lib/practice-access";
import {
  clientIp,
  rateLimitKeyPart,
  withinRateLimit,
} from "../../lib/rate-limit";
import { addDays, toZonedDate } from "../../lib/schedule";
import { resolveService } from "../../lib/services";
import { waitlistConfirmUrl } from "../../lib/urls";
import { countOpenWishes, lockWishes } from "../../lib/waitlist";
import { publicProcedure } from "../../orpc";

/** Requests from one address: a person leaves a wish or two, not ten in ten minutes. */
const PER_IP = { limit: 10, windowSeconds: 10 * 60 };

/** Confirmation mails to one email (any practice) an hour: nobody gets flooded. */
const PER_EMAIL = { limit: 3, windowSeconds: 60 * 60 };

/**
 * Leave a wish on the practice's waiting list: dates, optionally hours and a
 * service. When matching time frees up (a cancelled or moved booking) the
 * person is told once, by mail or messenger, and books it on the page — the
 * time is not held for them.
 *
 * A signed-in client uses their own account and is confirmed at once
 * (`{ status: "confirmed", id }`). A visitor leaves name, phone and email, as
 * when booking, and anyone can type anyone's email — so the wish only waits
 * (`{ status: "pending" }`): a mail with a link goes to that address and
 * `waitlist.confirm` makes the wish real. Until then it is neither listed nor
 * told of anything nor counted toward the limit, and it is dropped after
 * `WAITLIST_CONFIRM_HOURS`. The reply is the same for every email, the
 * practice's own staff included: for them nothing is stored or sent, and
 * nothing in the reply says so.
 *
 * STAFF for staff signed in; DATES_PAST when the whole range is over;
 * TOO_MANY when a signed-in client already has three open wishes here (a
 * visitor hears of it when confirming, not before: the reply must not tell
 * what is behind an email); RATE_LIMITED past 10 requests in ten minutes from
 * one address or 3 confirmation mails an hour to one email.
 *
 * @example client.waitlist.join({ practiceId, fromDate: "2026-11-09", toDate: "2026-11-15", fromMinute: 1080, toMinute: null, name: "Иван", phone: "+7 900 000-00-00", email: "ivan@example.com" })
 */
export const join = publicProcedure
  .errors({
    NOT_FOUND: { message: "Практика не найдена — обновите страницу" },
    SERVICE_NOT_FOUND: { message: "Услуга не найдена — обновите страницу" },
    GUEST_INVALID: { message: "Проверьте имя, телефон и почту" },
    DATES_PAST: { message: "Эти даты уже прошли — выберите другие" },
    DATES_TOO_FAR: {
      message: `Лист ожидания открыт на ${WAITLIST_MAX_DAYS} дней вперёд — выберите даты ближе`,
    },
    STAFF: {
      message: "Вы ведёте эту практику: лист ожидания нужен её клиентам",
    },
    TOO_MANY: {
      message: `Одновременно можно ждать не больше ${WAITLIST_MAX_ENTRIES} раз — удалите лишнее`,
    },
    RATE_LIMITED: {
      message: "Слишком много попыток — попробуйте чуть позже",
    },
    MAIL_FAILED: {
      message: "Не удалось отправить письмо — попробуйте ещё раз чуть позже",
    },
  })
  .input(waitlistJoinSchema.and(z.object({ practiceId: z.uuid() })))
  .handler(async ({ context, input, errors }) => {
    // Before anything is read or written: one address can't keep us busy.
    const ip = clientIp(context.headers);
    if (
      ip &&
      !(await withinRateLimit(context.db, {
        key: `waitlist-join:ip:${ip}`,
        ...PER_IP,
      }))
    ) {
      throw errors.RATE_LIMITED();
    }

    const practice = await findOpenPractice(context.db, input.practiceId);
    if (!practice) throw errors.NOT_FOUND();

    const today = toZonedDate(new Date(), practice.timezone);
    if (input.toDate < today) throw errors.DATES_PAST();
    // The window is counted from today, not from the first day asked for.
    if (input.toDate > addDays(today, WAITLIST_MAX_DAYS)) {
      throw errors.DATES_TOO_FAR();
    }

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

    // A wish never starts in the past.
    let fromDate = input.fromDate;
    if (fromDate < today) fromDate = today;
    const wish = {
      practiceId: practice.id,
      serviceId: input.serviceId ?? null,
      fromDate,
      toDate: input.toDate,
      fromMinute: input.fromMinute,
      toMinute: input.toMinute,
    };

    const pending = { status: "pending" as const };

    /** One mail an hour per email, whoever asks for it. */
    const limitEmail = async (email: string) => {
      if (
        !(await withinRateLimit(context.db, {
          key: `waitlist-join:email:${rateLimitKeyPart(email)}`,
          ...PER_EMAIL,
        }))
      ) {
        throw errors.RATE_LIMITED();
      }
    };

    /** The wish waits for the link mailed to the email of `account`. */
    const waitForEmail = async (account: { id: string; email: string }) => {
      const member = await findMembership(context.db, practice.id, account.id);
      // Staff of the practice: the same reply as anyone, nothing kept or sent.
      if (member && member.role !== "client") return pending;

      const token = newGuestToken();
      const entry = await context.db.transaction(async (tx) => {
        await lockWishes(tx, practice.id, account.id);
        // Wishes nobody confirmed in time are dropped, here, where they were
        // made; and one person keeps at most WAITLIST_MAX_PENDING waiting
        // ones, the oldest giving way — so a stranger typing an email can't
        // fill its owner's place.
        const cutoff = new Date(
          Date.now() - WAITLIST_CONFIRM_HOURS * 3_600_000,
        );
        await tx
          .delete(WaitlistEntry)
          .where(
            and(
              eq(WaitlistEntry.practiceId, practice.id),
              isNull(WaitlistEntry.confirmedAt),
              lt(WaitlistEntry.createdAt, cutoff),
            ),
          );
        const crowded = await tx
          .select({ id: WaitlistEntry.id })
          .from(WaitlistEntry)
          .where(
            and(
              eq(WaitlistEntry.practiceId, practice.id),
              eq(WaitlistEntry.userId, account.id),
              isNull(WaitlistEntry.confirmedAt),
            ),
          )
          .orderBy(desc(WaitlistEntry.createdAt))
          .offset(WAITLIST_MAX_PENDING - 1);
        if (crowded.length > 0) {
          await tx.delete(WaitlistEntry).where(
            inArray(
              WaitlistEntry.id,
              crowded.map((row) => row.id),
            ),
          );
        }
        const [inserted] = await tx
          .insert(WaitlistEntry)
          .values({
            ...wish,
            userId: account.id,
            confirmTokenHash: hashGuestToken(token),
          })
          .returning({ id: WaitlistEntry.id });
        if (!inserted) throw new Error("Failed to insert waitlist entry");
        return inserted;
      });

      try {
        await context.sendEmail({
          template: "waitlist-confirm",
          to: [account.email],
          subject: `Подтвердите лист ожидания: ${practice.name}`,
          props: {
            practiceName: practice.name,
            confirmUrl: waitlistConfirmUrl(token),
            hours: WAITLIST_CONFIRM_HOURS,
          },
        });
      } catch (error) {
        // Nobody can confirm a wish they never got the link for.
        await context.db
          .delete(WaitlistEntry)
          .where(eq(WaitlistEntry.id, entry.id));
        logger.warn("waitlist.confirm_mail_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw errors.MAIL_FAILED();
      }
      return pending;
    };

    const session = context.session;
    if (!session) {
      // A visitor: anyone can type anyone's email, so the wish waits.
      const details = waitlistGuestSchema.safeParse(input);
      if (!details.success) {
        throw errors.GUEST_INVALID({
          message: details.error.issues[0]?.message,
        });
      }
      await limitEmail(details.data.email);
      return waitForEmail(
        await findOrCreateGuestAccount(context.db, details.data),
      );
    }

    const userId = session.user.id;
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
    // A session is no proof of the address: password sign-up opens one for an
    // email nobody has confirmed. Those wait for the link like a visitor.
    if (!session.user.emailVerified) {
      await limitEmail(session.user.email);
      return waitForEmail(session.user);
    }
    await context.db
      .insert(PracticeMember)
      .values({ practiceId: practice.id, userId, role: "client" })
      .onConflictDoNothing();

    // Counting and inserting under one lock per person and practice: two
    // requests at once can't both pass the limit.
    const entry = await context.db.transaction(async (tx) => {
      await lockWishes(tx, practice.id, userId);
      if (
        (await countOpenWishes(tx, practice.id, userId, today)) >=
        WAITLIST_MAX_ENTRIES
      ) {
        throw errors.TOO_MANY();
      }
      const [inserted] = await tx
        .insert(WaitlistEntry)
        .values({
          ...wish,
          userId,
          confirmedAt: new Date(),
          confirmedEmail: session.user.email.toLowerCase(),
        })
        .returning({ id: WaitlistEntry.id });
      if (!inserted) throw new Error("Failed to insert waitlist entry");
      return inserted;
    });

    track("waitlist_joined", userId, {
      practiceId: practice.id,
      serviceId: input.serviceId ?? null,
    });
    return { status: "confirmed" as const, id: entry.id };
  });
