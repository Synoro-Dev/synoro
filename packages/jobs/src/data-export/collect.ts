import {
  AvailabilityRule,
  and,
  asc,
  Booking,
  BookingSeries,
  CreditEntry,
  type Database,
  eq,
  gte,
  Payment,
  PaymentAccount,
  PaymentPackage,
  Practice,
  PracticeDomain,
  PracticeMember,
  PracticeSlugAlias,
  SlugOrder,
  Subscription,
  SubscriptionPayment,
  user,
  Workflow,
} from "@synoro/db";

/**
 * Bump when a field changes meaning or goes away, and teach the importer the
 * old version: archives from a year ago must still import. New optional fields
 * don't need a bump. The format is described in `docs/data-format.md`.
 */
export const DATA_FORMAT_VERSION = 1;

function iso(at: Date | null | undefined) {
  return at ? at.toISOString() : null;
}

/** Everyone in the practice: clients and staff, each with their account's contacts. */
async function loadPeople(db: Database, practiceId: string) {
  const rows = await db
    .select({
      id: PracticeMember.id,
      role: PracticeMember.role,
      credits: PracticeMember.credits,
      name: user.name,
      email: user.email,
      phone: user.phone,
      createdAt: PracticeMember.createdAt,
    })
    .from(PracticeMember)
    .innerJoin(user, eq(user.id, PracticeMember.userId))
    .where(eq(PracticeMember.practiceId, practiceId))
    .orderBy(asc(PracticeMember.createdAt), asc(PracticeMember.id));
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    phone: row.phone,
    credits: row.credits,
    created_at: iso(row.createdAt),
  }));
}

/** The practice's bookings, oldest first, optionally from a moment on. */
async function loadBookings(db: Database, practiceId: string, since?: Date) {
  const rows = await db
    .select()
    .from(Booking)
    .where(
      and(
        eq(Booking.practiceId, practiceId),
        since ? gte(Booking.startsAt, since) : undefined,
      ),
    )
    .orderBy(asc(Booking.startsAt), asc(Booking.id));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    starts_at: iso(row.startsAt) as string,
    ends_at: iso(row.endsAt) as string,
    client_id: row.memberId,
    guest_name: row.guestName,
    guest_phone: row.guestPhone,
    guest_contact: row.guestContact,
    note: row.note,
    client_timezone: row.clientTimezone,
    answers: row.answers,
    series_id: row.seriesId,
    meeting_url: row.meetingUrl,
    hold_until: iso(row.holdUntil),
    cancel_reason: row.cancelReason,
    cancelled_at: iso(row.cancelledAt),
    created_at: iso(row.createdAt),
  }));
}

/**
 * One practice as it goes into `data.json`. Left out on purpose: merchant
 * keys, Google tokens, messenger chats and the hashes of booking links.
 */
export async function collectPractice(db: Database, practiceId: string) {
  const practice = await db.query.Practice.findFirst({
    where: eq(Practice.id, practiceId),
  });
  if (!practice) throw new Error(`No practice ${practiceId}`);

  const [
    people,
    bookings,
    rules,
    aliases,
    domains,
    packages,
    series,
    payments,
    accounts,
    workflows,
    credits,
  ] = await Promise.all([
    loadPeople(db, practice.id),
    loadBookings(db, practice.id),
    db
      .select()
      .from(AvailabilityRule)
      .where(eq(AvailabilityRule.practiceId, practice.id))
      .orderBy(
        asc(AvailabilityRule.weekday),
        asc(AvailabilityRule.startMinute),
      ),
    db
      .select()
      .from(PracticeSlugAlias)
      .where(eq(PracticeSlugAlias.practiceId, practice.id))
      .orderBy(asc(PracticeSlugAlias.slug)),
    db
      .select({ hostname: PracticeDomain.hostname })
      .from(PracticeDomain)
      .where(eq(PracticeDomain.practiceId, practice.id)),
    db
      .select()
      .from(PaymentPackage)
      .where(eq(PaymentPackage.practiceId, practice.id))
      .orderBy(asc(PaymentPackage.credits)),
    db
      .select()
      .from(BookingSeries)
      .where(eq(BookingSeries.practiceId, practice.id))
      .orderBy(asc(BookingSeries.createdAt), asc(BookingSeries.id)),
    db
      .select()
      .from(Payment)
      .where(eq(Payment.practiceId, practice.id))
      .orderBy(asc(Payment.createdAt), asc(Payment.id)),
    db
      .select({
        provider: PaymentAccount.provider,
        active: PaymentAccount.active,
        test: PaymentAccount.test,
        receipts: PaymentAccount.receipts,
        taxSystem: PaymentAccount.taxSystem,
      })
      .from(PaymentAccount)
      .where(eq(PaymentAccount.practiceId, practice.id))
      .orderBy(asc(PaymentAccount.provider)),
    db
      .select()
      .from(Workflow)
      .where(eq(Workflow.practiceId, practice.id))
      .orderBy(asc(Workflow.createdAt), asc(Workflow.id)),
    db
      .select({
        id: CreditEntry.id,
        memberId: CreditEntry.memberId,
        delta: CreditEntry.delta,
        reason: CreditEntry.reason,
        bookingId: CreditEntry.bookingId,
        paymentId: CreditEntry.paymentId,
        note: CreditEntry.note,
        createdAt: CreditEntry.createdAt,
      })
      .from(CreditEntry)
      .innerJoin(PracticeMember, eq(PracticeMember.id, CreditEntry.memberId))
      .where(eq(PracticeMember.practiceId, practice.id))
      .orderBy(asc(CreditEntry.createdAt), asc(CreditEntry.id)),
  ]);

  return {
    id: practice.id,
    name: practice.name,
    slug: practice.slug,
    old_slugs: aliases.map((alias) => alias.slug),
    domains: domains.map((domain) => domain.hostname),
    timezone: practice.timezone,
    profession: practice.profession,
    video_url: practice.videoUrl,
    client_contact: practice.clientContact,
    booking_questions: practice.bookingQuestions,
    booking_theme: practice.bookingTheme,
    free_booking_enabled: practice.freeBookingEnabled,
    intro_minutes: practice.introMinutes,
    remind_clients: practice.remindClients,
    notify_staff: practice.notifyStaff,
    daily_agenda: practice.dailyAgenda,
    created_at: iso(practice.createdAt),
    working_hours: rules.map((rule) => ({
      weekday: rule.weekday,
      start_minute: rule.startMinute,
      end_minute: rule.endMinute,
    })),
    team: people.filter((person) => person.role !== "client"),
    clients: people
      .filter((person) => person.role === "client")
      .map(({ role: _, ...client }) => client),
    packages: packages.map((row) => ({
      credits: row.credits,
      price_kopecks: row.price,
    })),
    series: series.map((row) => ({
      id: row.id,
      client_id: row.memberId,
      interval_weeks: row.intervalWeeks,
      count: row.count,
      cancelled_at: iso(row.cancelledAt),
      created_at: iso(row.createdAt),
    })),
    bookings,
    credit_entries: credits.map((row) => ({
      id: row.id,
      client_id: row.memberId,
      delta: row.delta,
      reason: row.reason,
      booking_id: row.bookingId,
      payment_id: row.paymentId,
      note: row.note,
      created_at: iso(row.createdAt),
    })),
    payments: payments.map((row) => ({
      id: row.id,
      client_id: row.memberId,
      booking_id: row.bookingId,
      provider: row.provider,
      external_id: row.externalId,
      status: row.status,
      credits: row.credits,
      amount_kopecks: row.amount,
      paid_at: iso(row.paidAt),
      created_at: iso(row.createdAt),
    })),
    payment_accounts: accounts.map((row) => ({
      provider: row.provider,
      active: row.active,
      test: row.test,
      receipts: row.receipts,
      tax_system: row.taxSystem,
    })),
    messages: workflows.map((row) => ({
      trigger: row.trigger,
      amount: row.amount,
      subject: row.subject,
      text: row.text,
      active: row.active,
    })),
  };
}

export type PracticeDump = Awaited<ReturnType<typeof collectPractice>>;

/** What the owner gets of the account itself, and every practice they own. */
export async function collectAccount(
  db: Database,
  userId: string,
  now = new Date(),
) {
  const account = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!account) throw new Error(`No user ${userId}`);

  const [owned, subscription, subscriptionPayments, slugOrders] =
    await Promise.all([
      db
        .select({ id: Practice.id })
        .from(Practice)
        .where(eq(Practice.ownerId, userId))
        .orderBy(asc(Practice.createdAt), asc(Practice.id)),
      db.query.Subscription.findFirst({
        where: eq(Subscription.userId, userId),
      }),
      db
        .select()
        .from(SubscriptionPayment)
        .where(eq(SubscriptionPayment.userId, userId))
        .orderBy(asc(SubscriptionPayment.createdAt)),
      db
        .select()
        .from(SlugOrder)
        .where(eq(SlugOrder.userId, userId))
        .orderBy(asc(SlugOrder.createdAt)),
    ]);

  // One at a time: a practice is several queries, the pool is shared.
  const practices: PracticeDump[] = [];
  for (const { id } of owned) practices.push(await collectPractice(db, id));

  return {
    format_version: DATA_FORMAT_VERSION,
    exported_at: now.toISOString(),
    account: {
      name: account.name,
      email: account.email,
      phone: account.phone,
      username: account.username,
      bio: account.bio,
      created_at: iso(account.createdAt),
    },
    subscription: subscription
      ? {
          trial_ends_at: iso(subscription.trialEndsAt),
          paid_until: iso(subscription.paidUntil),
        }
      : null,
    subscription_payments: subscriptionPayments.map((row) => ({
      number: row.number,
      period: row.period,
      amount_kopecks: row.amount,
      status: row.status,
      external_id: row.externalId,
      period_start: iso(row.periodStart),
      period_end: iso(row.periodEnd),
      paid_at: iso(row.paidAt),
      refunded_at: iso(row.refundedAt),
      created_at: iso(row.createdAt),
    })),
    slug_orders: slugOrders.map((row) => ({
      number: row.number,
      slug: row.slug,
      amount_kopecks: row.amount,
      status: row.status,
      external_id: row.externalId,
      paid_at: iso(row.paidAt),
      created_at: iso(row.createdAt),
    })),
    practices,
  };
}

export type AccountDump = Awaited<ReturnType<typeof collectAccount>>;

/** The feed needs bookings and names only, not the whole practice. */
export async function collectForFeed(
  db: Database,
  practiceId: string,
  since: Date,
) {
  const [people, bookings] = await Promise.all([
    loadPeople(db, practiceId),
    loadBookings(db, practiceId, since),
  ]);
  return { people, bookings };
}
