import { createHash, randomBytes } from "node:crypto";

import { logger } from "@synoro/config";
import { type Database, eq, PracticeMember, sql, user } from "@synoro/db";
import { dispatchEmail } from "@synoro/jobs";

import { findMembership } from "./practice-access";
import { cabinetUrl, guestBookingUrl } from "./urls";

const formatIn = (
  at: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) => new Intl.DateTimeFormat("ru-RU", { timeZone, ...options }).format(at);

/**
 * Mail the visitor the link that opens their booking without signing in:
 * a paid one held until `holdUntil`, or a free intro (`intro` — its name,
 * «Знакомство»), confirmed at once. A mail failure must not undo the
 * booking — the page they land on leads to the same link — so it is only
 * logged.
 */
export async function sendBookingLink(input: {
  email: string;
  name: string;
  practiceName: string;
  timeZone: string;
  startsAt: Date;
  holdUntil: Date | null;
  intro?: string;
  /** The video room, for an intro (a paid booking gets it once paid). */
  videoUrl?: string | null;
  token: string;
}) {
  try {
    await dispatchEmail({
      template: "booking-link",
      to: [input.email],
      subject: input.intro
        ? `${input.intro}: ${input.practiceName}`
        : `Ваша запись: ${input.practiceName}`,
      props: {
        name: input.name,
        practiceName: input.practiceName,
        when: formatIn(input.startsAt, input.timeZone, {
          weekday: "long",
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        }),
        holdUntil: input.holdUntil
          ? formatIn(input.holdUntil, input.timeZone, {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "",
        intro: input.intro ?? null,
        videoUrl: input.videoUrl ?? null,
        bookingUrl: guestBookingUrl(input.token),
        cabinetUrl: cabinetUrl(),
      },
    });
  } catch (error) {
    logger.warn("booking.link_email_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** A fresh secret for a visitor's `/b/<token>` link. */
export function newGuestToken() {
  return randomBytes(24).toString("base64url");
}

/** What the database keeps of a token: the link works, the table cannot leak it. */
export function hashGuestToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The account and client membership of a visitor who books without signing
 * in. The account is found by email or created passive (email not verified,
 * no password): a visitor opens it later by asking for an emailed code, and
 * finds their bookings and balance there. Nothing is trusted from the form
 * beyond that — an existing account keeps its name and phone, an unverified
 * email proves nothing, and staff of the practice must sign in instead.
 *
 * `staff` is returned for the latter case, with nothing created.
 */
export async function findOrCreateGuestMember(
  db: Database,
  practiceId: string,
  guest: { name: string; email: string; phone: string },
) {
  const email = guest.email.trim().toLowerCase();
  const byEmail = () =>
    db.query.user.findFirst({ where: sql`lower(${user.email}) = ${email}` });

  let account = await byEmail();
  if (!account) {
    await db
      .insert(user)
      .values({
        id: crypto.randomUUID(),
        name: guest.name,
        email,
        phone: guest.phone,
      })
      .onConflictDoNothing();
    account = await byEmail();
  } else if (!account.phone) {
    await db
      .update(user)
      .set({ phone: guest.phone })
      .where(eq(user.id, account.id));
  }
  if (!account) throw new Error("Failed to create the guest account");

  await db
    .insert(PracticeMember)
    .values({ practiceId, userId: account.id, role: "client" })
    .onConflictDoNothing();
  const member = await findMembership(db, practiceId, account.id);
  if (!member) throw new Error("Failed to create the guest membership");
  if (member.role !== "client") return { staff: true as const };

  return {
    staff: false as const,
    user: { id: account.id, email: account.email },
    memberId: member.id,
  };
}
