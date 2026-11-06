import {
  ArchivedRecord,
  AvailabilityRule,
  and,
  Booking,
  BookingSeries,
  count,
  type Database,
  eq,
  ImportBatch,
  ImportBatchItem,
  isExclusionViolation,
  PaymentPackage,
  Practice,
  PracticeClient,
  PracticeMember,
  Workflow,
} from "@synoro/db";
import {
  bookingQuestionsSchema,
  canonicalTimeZone,
  normalizePhone,
  normalizeVideoUrl,
  PROFESSIONS,
  readBookingTheme,
} from "@synoro/validators";
import { strFromU8, unzipSync } from "fflate";
import { z } from "zod";

import { DATA_FORMAT_VERSION } from "../data-export/collect";
import { doneItems, loadImportFile } from "./apply-file";
import { FileProblem } from "./parse";

/**
 * Bringing back an archive of ours (`data.json`). The file is whatever someone
 * uploads, so nothing in it is trusted: every field goes through a schema here
 * or a validator the app already has, ids are remapped, and nobody is attached
 * by the addresses it names. See `docs/data-format.md`.
 */

const text = (max: number) => z.string().max(max);
const moment = z.iso.datetime({ offset: true });

const clientSchema = z.object({
  id: z.string().max(64),
  // An account's name has no limit of its own, a card's does.
  name: text(1000)
    .min(1)
    .transform((name) => name.slice(0, 120)),
  email: text(320).nullish(),
  phone: text(32).nullish(),
  credits: z.number().int().min(0).max(100_000).default(0),
  note: text(2000).nullish(),
  created_at: moment.nullish(),
});

const bookingSchema = z
  .object({
    id: z.string().max(64),
    kind: z.enum(["consultation", "free", "blocked"]),
    status: z.enum(["active", "cancelled"]),
    starts_at: moment,
    ends_at: moment,
    client_id: z.string().max(64).nullish(),
    guest_name: text(120).nullish(),
    guest_phone: text(32).nullish(),
    guest_contact: text(120).nullish(),
    note: text(500).nullish(),
    client_timezone: text(64).nullish(),
    answers: z
      .array(z.object({ question: text(500), answer: text(2000) }))
      .max(50)
      .nullish(),
    series_id: z.string().max(64).nullish(),
    meeting_url: text(500).nullish(),
    hold_until: moment.nullish(),
    cancel_reason: z
      .enum(["client", "staff", "no_show", "hold_expired", "payment_cancelled"])
      .nullish(),
    cancelled_at: moment.nullish(),
    created_at: moment.nullish(),
  })
  .refine((row) => new Date(row.starts_at) < new Date(row.ends_at))
  .refine((row) => (row.status === "cancelled") === Boolean(row.cancel_reason));

const practiceSchema = z.object({
  name: text(120).min(1),
  timezone: text(64),
  profession: z.enum(PROFESSIONS).catch("other"),
  video_url: text(500).nullish(),
  client_contact: text(200).nullish(),
  booking_questions: z.unknown(),
  booking_theme: z.unknown(),
  free_booking_enabled: z.boolean().default(false),
  intro_minutes: z.union([
    z.literal(30),
    z.literal(45),
    z.literal(60),
    z.literal(90),
  ]),
  remind_clients: z.boolean().default(true),
  notify_staff: z.boolean().default(true),
  daily_agenda: z.boolean().default(true),
  working_hours: z
    .array(
      z
        .object({
          weekday: z.number().int().min(1).max(7),
          start_minute: z.number().int().min(0).max(1440).multipleOf(30),
          end_minute: z.number().int().min(0).max(1440).multipleOf(30),
        })
        .refine((rule) => rule.start_minute < rule.end_minute),
    )
    // As many as the working hours form allows (`availabilityFormSchema`).
    .max(168)
    .default([]),
  team: z.array(clientSchema.extend({ role: z.string() })).default([]),
  clients: z.array(clientSchema).default([]),
  imported_clients: z.array(clientSchema).default([]),
  packages: z
    .array(
      z.object({
        credits: z.number().int().min(1).max(100),
        price_kopecks: z.number().int().positive().max(100_000_000),
      }),
    )
    .max(100)
    .default([]),
  series: z
    .array(
      z.object({
        id: z.string().max(64),
        client_id: z.string().max(64).nullish(),
        interval_weeks: z.union([z.literal(1), z.literal(2)]),
        count: z.number().int().min(2).max(12),
        cancelled_at: moment.nullish(),
        created_at: moment.nullish(),
      }),
    )
    .default([]),
  bookings: z.array(bookingSchema).default([]),
  // History goes out again in the next export, so it's checked as strictly as
  // what lives in tables: a bad date here would break that export.
  credit_entries: z
    .array(
      z.object({
        id: z.string().max(64),
        client_id: z.string().max(64).nullish(),
        delta: z.number().int().min(-100_000).max(100_000),
        reason: z.enum(["purchase", "booking", "refund", "adjustment"]),
        booking_id: z.string().max(64).nullish(),
        payment_id: z.string().max(64).nullish(),
        note: text(500).nullish(),
        created_at: moment.nullish(),
      }),
    )
    .default([]),
  payments: z
    .array(
      z.object({
        id: z.string().max(64),
        client_id: z.string().max(64).nullish(),
        booking_id: z.string().max(64).nullish(),
        provider: z.enum(["yookassa", "tbank"]),
        external_id: text(64).nullish(),
        status: z.enum(["pending", "succeeded", "canceled"]),
        credits: z.number().int().min(0).max(100_000),
        amount_kopecks: z.number().int().min(0).max(100_000_000_000),
        paid_at: moment.nullish(),
        created_at: moment.nullish(),
      }),
    )
    .default([]),
  messages: z
    .array(
      z
        .object({
          trigger: z.enum(["after_end", "low_balance", "inactive"]),
          amount: z.number().int(),
          subject: text(120).min(1),
          text: text(1000).min(1),
          active: z.boolean(),
        })
        .refine(({ trigger, amount }) =>
          trigger === "after_end"
            ? amount >= 1 && amount <= 72
            : trigger === "low_balance"
              ? amount >= 0 && amount <= 5
              : amount >= 7 && amount <= 180,
        ),
    )
    .max(50)
    .default([]),
});

const archiveSchema = z.object({
  format_version: z.number().int().min(1),
  practices: z.array(practiceSchema).min(1).max(50),
});

/**
 * Old archives must still load. A format change adds a step here that turns the
 * previous version's JSON into the next one's; version 1 needs none.
 */
const UPGRADES: Record<number, (raw: Record<string, unknown>) => unknown> = {};

function upgrade(raw: Record<string, unknown>) {
  let current = raw;
  let version = Number(current.format_version);
  while (version < DATA_FORMAT_VERSION) {
    const step = UPGRADES[version];
    if (step) current = step(current) as Record<string, unknown>;
    version++;
    current = { ...current, format_version: version };
  }
  return current;
}

/** `data.json` itself, or the ZIP it came in. */
function jsonOf(bytes: Uint8Array) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const files = unzipSync(bytes, {
      filter: (file) =>
        file.name === "data.json" && file.originalSize < 200 * 1024 * 1024,
    });
    const file = files["data.json"];
    if (!file) throw new FileProblem("В этом архиве нет файла data.json");
    return strFromU8(file);
  }
  return strFromU8(bytes);
}

export function readArchive(bytes: Uint8Array) {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonOf(bytes));
  } catch (error) {
    if (error instanceof FileProblem) throw error;
    throw new FileProblem("Это не похоже на архив Synoro");
  }
  const version = (raw as { format_version?: unknown } | null)?.format_version;
  // Before `upgrade`, which walks from this number: a huge negative one would
  // keep it busy for good.
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    throw new FileProblem("Это не похоже на архив Synoro");
  }
  if (version > DATA_FORMAT_VERSION) {
    throw new FileProblem(
      "Этот архив из более новой версии Synoro. Обновите страницу и попробуйте снова",
    );
  }
  const parsed = archiveSchema.safeParse(
    upgrade(raw as Record<string, unknown>),
  );
  if (!parsed.success) {
    // The path only: a message may quote a value from the file.
    const path = parsed.error.issues[0]?.path.join(".");
    throw new FileProblem(`Архив повреждён, не читается поле ${path}`);
  }
  return parsed.data;
}

/** Nothing here yet: then the practice's settings come from the archive too. */
export async function isCleanPractice(db: Database, practiceId: string) {
  const [[bookings], [clients], [members]] = await Promise.all([
    db
      .select({ value: count() })
      .from(Booking)
      .where(eq(Booking.practiceId, practiceId)),
    db
      .select({ value: count() })
      .from(PracticeClient)
      .where(eq(PracticeClient.practiceId, practiceId)),
    db
      .select({ value: count() })
      .from(PracticeMember)
      .where(
        and(
          eq(PracticeMember.practiceId, practiceId),
          eq(PracticeMember.role, "client"),
        ),
      ),
  ]);
  return (
    (bookings?.value ?? 0) + (clients?.value ?? 0) + (members?.value ?? 0) === 0
  );
}

function date(value: string | null | undefined) {
  return value ? new Date(value) : undefined;
}

/**
 * Write one practice of an archive into this one. What can't go in is skipped,
 * not fatal: a client whose contact is already taken, a booking on a taken time.
 * Unpaid holds stay behind: they meant nothing past their minutes. Nobody is told,
 * as with any import.
 */
export async function applyArchive(
  db: Database,
  batchId: string,
  practiceIndex: number,
) {
  const batch = await db.query.ImportBatch.findFirst({
    where: eq(ImportBatch.id, batchId),
  });
  const file = await loadImportFile(db, batchId);
  if (!batch || !file) throw new Error(`Import ${batchId} has no file`);
  const archive = readArchive(file).practices[practiceIndex];
  if (!archive) throw new Error(`Import ${batchId} has no such practice`);
  const { practiceId } = batch;

  // Decided once and kept: on a rerun the practice is no longer empty.
  const clean =
    batch.options?.archiveClean ?? (await isCleanPractice(db, practiceId));
  if (batch.options && batch.options.archiveClean === undefined) {
    await db
      .update(ImportBatch)
      .set({ options: { ...batch.options, archiveClean: clean } })
      .where(eq(ImportBatch.id, batchId));
  }

  // What an earlier attempt wrote, by where it came from in the file.
  const done = await doneItems(db, batchId);
  let added = 0;
  let merged = 0;
  let skipped = 0;

  const note = async (
    tx: Database,
    entity: typeof ImportBatchItem.$inferInsert.entity,
    entityId: string,
    sourceKey: string,
    change?: {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    },
  ) =>
    tx.insert(ImportBatchItem).values({
      batchId,
      entity,
      entityId,
      sourceKey,
      action: change ? "merged" : "added",
      before: change?.before ?? null,
      after: change?.after ?? null,
    });
  const progress = (value: number) =>
    db
      .update(ImportBatch)
      .set({ progress: value })
      .where(eq(ImportBatch.id, batchId));

  // People: every client becomes a card, nobody is joined by their address.
  const cardOf = new Map<string, string>();
  const nameOf = new Map<string, string>();
  const phoneOf = new Map<string, string>();
  for (const person of archive.team) nameOf.set(person.id, person.name);
  const people = [...archive.clients, ...archive.imported_clients];
  await db.transaction(async (tx) => {
    for (const person of people) {
      nameOf.set(person.id, person.name);
      const phone = person.phone ? normalizePhone(person.phone) : null;
      if (phone) phoneOf.set(person.id, phone);
      const sourceKey = `client:${person.id}`;
      const written = done.get(sourceKey);
      if (written) {
        cardOf.set(person.id, written);
        continue;
      }
      const [card] = await tx
        .insert(PracticeClient)
        .values({
          practiceId,
          name: person.name,
          phone,
          email: person.email?.toLowerCase() || null,
          note: person.note ?? null,
          credits: person.credits,
          batchId,
          createdAt: date(person.created_at),
        })
        .onConflictDoNothing()
        .returning({ id: PracticeClient.id });
      if (!card) {
        skipped++;
        continue;
      }
      cardOf.set(person.id, card.id);
      await note(tx as unknown as Database, "client", card.id, sourceKey);
      added++;
    }
  });
  await progress(people.length);

  const seriesOf = new Map<string, string>();
  await db.transaction(async (tx) => {
    for (const row of archive.series) {
      const sourceKey = `series:${row.id}`;
      const written = done.get(sourceKey);
      if (written) {
        seriesOf.set(row.id, written);
        continue;
      }
      const clientId = row.client_id ? cardOf.get(row.client_id) : undefined;
      if (!clientId) {
        skipped++;
        continue;
      }
      const [series] = await tx
        .insert(BookingSeries)
        .values({
          practiceId,
          clientId,
          intervalWeeks: row.interval_weeks,
          count: row.count,
          cancelledAt: date(row.cancelled_at),
          createdAt: date(row.created_at),
        })
        .returning({ id: BookingSeries.id });
      if (!series) continue;
      seriesOf.set(row.id, series.id);
      await note(tx as unknown as Database, "series", series.id, sourceKey);
    }
  });

  const bookingOf = new Map<string, string>();
  for (const [index, row] of archive.bookings.entries()) {
    // Often enough to show it's alive, and to tell a worker from a dead one.
    if (index % 100 === 0) await progress(people.length + index);
    // An unpaid hold, not a booking.
    if (row.hold_until) {
      skipped++;
      continue;
    }
    const sourceKey = `booking:${row.id}`;
    const written = done.get(sourceKey);
    if (written) {
      bookingOf.set(row.id, written);
      continue;
    }
    const clientId = row.client_id ? cardOf.get(row.client_id) : undefined;
    const person = row.client_id ? nameOf.get(row.client_id) : undefined;
    // Staff reach the client through these: a card has no account to ask.
    const guestPhone = row.guest_phone
      ? normalizePhone(row.guest_phone)
      : row.client_id
        ? (phoneOf.get(row.client_id) ?? null)
        : null;
    try {
      await db.transaction(async (tx) => {
        const [booking] = await tx
          .insert(Booking)
          .values({
            practiceId,
            kind: row.kind,
            status: row.status,
            startsAt: new Date(row.starts_at),
            endsAt: new Date(row.ends_at),
            clientId: clientId ?? null,
            // What the calendar shows, for a booking with no account behind it.
            guestName: row.guest_name ?? person ?? null,
            guestPhone,
            guestContact: row.guest_contact ?? null,
            note: row.note ?? null,
            clientTimezone: row.client_timezone
              ? (canonicalTimeZone(row.client_timezone) ?? null)
              : null,
            answers: row.answers ?? null,
            seriesId: row.series_id
              ? (seriesOf.get(row.series_id) ?? null)
              : null,
            meetingUrl: row.meeting_url
              ? normalizeVideoUrl(row.meeting_url)
              : null,
            cancelReason: row.cancel_reason ?? null,
            cancelledAt: date(row.cancelled_at),
            createdAt: date(row.created_at),
            createdById: batch.createdById,
          })
          .returning({ id: Booking.id });
        if (!booking) throw new Error("Failed to insert booking");
        bookingOf.set(row.id, booking.id);
        await note(tx as unknown as Database, "booking", booking.id, sourceKey);
      });
      added++;
    } catch (error) {
      if (!isExclusionViolation(error, "bookings_no_overlap")) throw error;
      skipped++;
    }
  }

  // History: as it was, with the ids it points to changed to the new ones.
  const remap = (record: {
    client_id?: string | null;
    booking_id?: string | null;
  }) => ({
    ...record,
    client_id: record.client_id ? (cardOf.get(record.client_id) ?? null) : null,
    booking_id: record.booking_id
      ? (bookingOf.get(record.booking_id) ?? null)
      : null,
  });
  await db.transaction(async (tx) => {
    const records = [
      ...archive.payments.map((data) => ({ kind: "payment" as const, data })),
      ...archive.credit_entries.map((data) => ({
        kind: "credit_entry" as const,
        data,
      })),
    ];
    for (const { kind, data } of records) {
      const sourceKey = `${kind}:${data.id}`;
      if (done.has(sourceKey)) continue;
      const [record] = await tx
        .insert(ArchivedRecord)
        .values({
          practiceId,
          kind,
          data: remap(data),
          createdAt: date(data.created_at) ?? new Date(),
        })
        .returning({ id: ArchivedRecord.id });
      if (record) {
        await note(tx as unknown as Database, "record", record.id, sourceKey);
      }
    }
  });

  // Settings only into an empty practice: never over what someone already set.
  if (clean && !done.has("settings")) {
    await db.transaction(async (tx) => {
      const db_ = tx as unknown as Database;
      const practice = await tx.query.Practice.findFirst({
        where: eq(Practice.id, practiceId),
      });
      if (!practice) return;
      const questions = bookingQuestionsSchema.safeParse(
        archive.booking_questions,
      );
      const settings = {
        name: archive.name,
        timezone: canonicalTimeZone(archive.timezone) ?? practice.timezone,
        profession: archive.profession,
        videoUrl: archive.video_url
          ? normalizeVideoUrl(archive.video_url)
          : null,
        clientContact: archive.client_contact ?? null,
        bookingQuestions: questions.success
          ? questions.data
          : practice.bookingQuestions,
        bookingTheme: readBookingTheme(archive.booking_theme),
        freeBookingEnabled: archive.free_booking_enabled,
        introMinutes: archive.intro_minutes,
        remindClients: archive.remind_clients,
        notifyStaff: archive.notify_staff,
        dailyAgenda: archive.daily_agenda,
      };
      await tx
        .update(Practice)
        .set(settings)
        .where(eq(Practice.id, practiceId));
      await note(db_, "settings", practiceId, "settings", {
        before: {
          name: practice.name,
          timezone: practice.timezone,
          profession: practice.profession,
          videoUrl: practice.videoUrl,
          clientContact: practice.clientContact,
          bookingQuestions: practice.bookingQuestions,
          bookingTheme: practice.bookingTheme,
          freeBookingEnabled: practice.freeBookingEnabled,
          introMinutes: practice.introMinutes,
          remindClients: practice.remindClients,
          notifyStaff: practice.notifyStaff,
          dailyAgenda: practice.dailyAgenda,
        },
        after: settings,
      });
      merged++;

      const hours = await tx
        .select({ id: AvailabilityRule.id })
        .from(AvailabilityRule)
        .where(eq(AvailabilityRule.practiceId, practiceId))
        .limit(1);
      if (hours.length === 0) {
        for (const [index, rule] of archive.working_hours.entries()) {
          const [row] = await tx
            .insert(AvailabilityRule)
            .values({
              practiceId,
              weekday: rule.weekday,
              startMinute: rule.start_minute,
              endMinute: rule.end_minute,
            })
            .returning({ id: AvailabilityRule.id });
          if (row) await note(db_, "hours", row.id, `hours:${index}`);
        }
      }
      for (const pack of archive.packages) {
        const [row] = await tx
          .insert(PaymentPackage)
          .values({
            practiceId,
            credits: pack.credits,
            price: pack.price_kopecks,
          })
          .onConflictDoNothing()
          .returning({ id: PaymentPackage.id });
        if (row) await note(db_, "package", row.id, `package:${pack.credits}`);
      }
      for (const [index, message] of archive.messages.entries()) {
        const [row] = await tx
          .insert(Workflow)
          .values({ practiceId, ...message })
          .returning({ id: Workflow.id });
        if (row) await note(db_, "message", row.id, `message:${index}`);
      }
    });
  }

  return { added, merged, skipped, errors: 0 };
}
