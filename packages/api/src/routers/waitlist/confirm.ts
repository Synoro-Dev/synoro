import {
  and,
  eq,
  isNull,
  PracticeMember,
  user,
  WaitlistEntry,
} from "@synoro/db";
import {
  WAITLIST_CONFIRM_HOURS,
  WAITLIST_MAX_ENTRIES,
} from "@synoro/validators";
import { z } from "zod";

import { hashGuestToken } from "../../lib/guests";
import { findOpenPractice } from "../../lib/practice-access";
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
    const found = await context.db.query.WaitlistEntry.findFirst({
      where: eq(WaitlistEntry.confirmTokenHash, hashGuestToken(input.token)),
      columns: { id: true, practiceId: true, userId: true },
    });
    if (!found) throw errors.NOT_FOUND();

    const practice = await findOpenPractice(context.db, found.practiceId);
    if (!practice) throw errors.NOT_FOUND();
    const today = toZonedDate(new Date(), practice.timezone);

    // Everything is decided under the person's lock, from a fresh read: a
    // second click, a new `join` that swept the wish, or another wish
    // confirmed meanwhile must see each other.
    const result = await context.db.transaction(async (tx) => {
      await lockWishes(tx, practice.id, found.userId);
      const entry = await tx.query.WaitlistEntry.findFirst({
        where: eq(WaitlistEntry.id, found.id),
      });
      if (!entry) return "gone" as const;
      if (entry.confirmedAt) return "already" as const;
      const expiresAt =
        entry.createdAt.getTime() + WAITLIST_CONFIRM_HOURS * 3_600_000;
      if (expiresAt < Date.now() || entry.toDate < today)
        return "gone" as const;

      // Became staff since: they sign in, nothing is made of the wish.
      const member = await tx.query.PracticeMember.findFirst({
        where: and(
          eq(PracticeMember.practiceId, practice.id),
          eq(PracticeMember.userId, entry.userId),
        ),
      });
      if (member && member.role !== "client") return "gone" as const;

      // The link went to the account's email as it is now: that is what the
      // wish is bound to (notices stop if a profile edit changes it).
      const [account] = await tx
        .select({ email: user.email })
        .from(user)
        .where(eq(user.id, entry.userId));
      if (!account) return "gone" as const;

      if (
        (await countOpenWishes(tx, practice.id, entry.userId, today)) >=
        WAITLIST_MAX_ENTRIES
      ) {
        throw errors.TOO_MANY();
      }
      await tx
        .insert(PracticeMember)
        .values({
          practiceId: practice.id,
          userId: entry.userId,
          role: "client",
        })
        .onConflictDoNothing();
      const [confirmed] = await tx
        .update(WaitlistEntry)
        .set({
          confirmedAt: new Date(),
          confirmedEmail: account.email.toLowerCase(),
        })
        .where(
          and(
            eq(WaitlistEntry.id, entry.id),
            isNull(WaitlistEntry.confirmedAt),
          ),
        )
        .returning({ id: WaitlistEntry.id });
      return confirmed ? ("confirmed" as const) : ("gone" as const);
    });

    if (result === "gone") throw errors.NOT_FOUND();
    return {
      practice: { name: practice.name, slug: practice.slug },
      already: result === "already",
    };
  });
