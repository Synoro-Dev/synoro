import { and, eq, isNull, PracticeMember, WaitlistEntry } from "@synoro/db";
import {
  WAITLIST_CONFIRM_HOURS,
  WAITLIST_MAX_ENTRIES,
} from "@synoro/validators";
import { z } from "zod";

import { hashGuestToken } from "../../lib/guests";
import { findMembership, findOpenPractice } from "../../lib/practice-access";
import { toZonedDate } from "../../lib/schedule";
import { countOpenWishes, lockWishes } from "../../lib/waitlist";
import { publicProcedure } from "../../orpc";

/**
 * Make a visitor's waiting-list wish real: the secret from the mail
 * `waitlist.join` sent to the address they left proves it is theirs. The
 * wish is then listed to staff and told of freed time, and the address
 * becomes a client of the practice. Opening the link again is harmless
 * (`already: true`).
 *
 * NOT_FOUND for a link that is wrong, older than `WAITLIST_CONFIRM_HOURS`,
 * for a wish whose days are over, a practice that closed or an address that
 * has since become staff; TOO_MANY when the person already has three open
 * wishes here (the link keeps working until one is dropped).
 *
 * @example client.waitlist.confirm({ token })
 */
export const confirm = publicProcedure
  .errors({
    NOT_FOUND: { message: "Ссылка недействительна или устарела" },
    TOO_MANY: {
      message: `Одновременно можно ждать не больше ${WAITLIST_MAX_ENTRIES} раз — удалите лишнее и откройте ссылку снова`,
    },
  })
  .input(z.object({ token: z.string().min(16).max(200) }))
  .handler(async ({ context, input, errors }) => {
    const entry = await context.db.query.WaitlistEntry.findFirst({
      where: eq(WaitlistEntry.confirmTokenHash, hashGuestToken(input.token)),
    });
    if (!entry) throw errors.NOT_FOUND();

    const practice = await findOpenPractice(context.db, entry.practiceId);
    if (!practice) throw errors.NOT_FOUND();
    const done = { practice: { name: practice.name, slug: practice.slug } };
    if (entry.confirmedAt) return { ...done, already: true };

    const expiresAt =
      entry.createdAt.getTime() + WAITLIST_CONFIRM_HOURS * 3_600_000;
    const today = toZonedDate(new Date(), practice.timezone);
    if (expiresAt < Date.now() || entry.toDate < today) {
      throw errors.NOT_FOUND();
    }

    // Became staff since: they sign in, nothing is made of the wish.
    const member = await findMembership(context.db, practice.id, entry.userId);
    if (member && member.role !== "client") throw errors.NOT_FOUND();
    await context.db
      .insert(PracticeMember)
      .values({ practiceId: practice.id, userId: entry.userId, role: "client" })
      .onConflictDoNothing();

    await context.db.transaction(async (tx) => {
      await lockWishes(tx, practice.id, entry.userId);
      if (
        (await countOpenWishes(tx, practice.id, entry.userId, today)) >=
        WAITLIST_MAX_ENTRIES
      ) {
        throw errors.TOO_MANY();
      }
      await tx
        .update(WaitlistEntry)
        .set({ confirmedAt: new Date() })
        .where(
          and(
            eq(WaitlistEntry.id, entry.id),
            isNull(WaitlistEntry.confirmedAt),
          ),
        );
    });
    return { ...done, already: false };
  });
