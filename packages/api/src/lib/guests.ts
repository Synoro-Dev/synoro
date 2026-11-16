import { createHash, randomBytes } from "node:crypto";

import { logger } from "@synoro/config";
import {
  and,
  Booking,
  type Database,
  eq,
  gt,
  isNotNull,
  isNull,
  PracticeMember,
  sql,
  user,
} from "@synoro/db";
import { dispatchEmail } from "@synoro/jobs";
import { describeDates, formatClock } from "@synoro/jobs/when";

import { findMembership } from "./practice-access";
import { cabinetUrl, guestBookingUrl } from "./urls";

/** One visitor cannot hold more unpaid times than this at once. */
const MAX_OPEN_HOLDS = 2;

/**
 * Whether the member already holds as many unpaid times as allowed. Call it
 * first thing in the transaction that adds a hold: it locks the member's row
 * (`for update`), so two parallel requests are checked one after the other
 * and can't both slip under the limit.
 */
export async function holdsAtLimit(tx: Database, memberId: string) {
  await tx
    .select({ id: PracticeMember.id })
    .from(PracticeMember)
    .where(eq(PracticeMember.id, memberId))
    .for("update");
  return (await countOpenHolds(tx, memberId)) >= MAX_OPEN_HOLDS;
}

/**
 * How many unpaid holds a member has now: a recurring booking waiting for its
 * payment is one hold, however many dates it takes.
 */
async function countOpenHolds(db: Database, memberId: string) {
  const [open] = await db
    .select({
      holds: sql<number>`count(distinct coalesce(${Booking.seriesId}, ${Booking.id}))`,
    })
    .from(Booking)
    .where(
      and(
        eq(Booking.memberId, memberId),
        eq(Booking.status, "active"),
        isNotNull(Booking.holdUntil),
        gt(Booking.holdUntil, new Date()),
        // Dates held for a standing time wait for a package, not for the
        // visitor's payment page: they are no part of this limit.
        isNull(Booking.standingId),
      ),
    );
  return Number(open?.holds ?? 0);
}

/**
 * Mail the visitor the link that opens their booking without signing in:
 * a paid one held until `holdUntil`, or a free intro (`intro` — its name,
 * «Знакомство»), confirmed at once. A mail failure must not undo the
 * booking — the page they land on leads to the same link — so it is only
 * logged. Returns whether the mail went out (was sent or queued).
 */
export async function sendBookingLink(input: {
  email: string;
  name: string;
  practiceName: string;
  /** The zone the mail writes the time in: the client's, else the practice's. */
  timeZone: string;
  startsAt: Date;
  /** All the dates of a recurring booking, the first one included. */
  dates?: Date[];
  holdUntil: Date | null;
  intro?: string;
  /** Booked to be paid at the visit (`bookAtVisit`): confirmed at once. */
  atVisit?: boolean;
  /** The video room, for a confirmed booking (a paid one gets it once paid). */
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
        when: describeDates(input.dates ?? [input.startsAt], input.timeZone, {
          named: true,
        }).when,
        holdUntil: input.holdUntil
          ? formatClock(input.holdUntil, input.timeZone)
          : "",
        intro: input.intro ?? null,
        atVisit: input.atVisit ?? false,
        videoUrl: input.videoUrl ?? null,
        bookingUrl: guestBookingUrl(input.token),
        cabinetUrl: cabinetUrl(),
      },
    });
    return true;
  } catch (error) {
    logger.warn("booking.link_email_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
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
 * The account of a visitor, found by email or created passive (email not
 * verified, no password): a visitor opens it later by asking for an emailed
 * code. Nothing is trusted from the form beyond that — an existing account
 * keeps its name, and an unverified email proves nothing. Creates no
 * membership: `findOrCreateGuestMember` does, `waitlist.confirm` does once the
 * email is proven.
 */
export async function findOrCreateGuestAccount(
  db: Database,
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
  return account;
}

/**
 * The account and client membership of a visitor who books without signing
 * in (see `findOrCreateGuestAccount`). Staff of the practice must sign in
 * instead: `staff` is returned for that case, with no membership created.
 */
export async function findOrCreateGuestMember(
  db: Database,
  practiceId: string,
  guest: { name: string; email: string; phone: string },
) {
  const account = await findOrCreateGuestAccount(db, guest);

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
