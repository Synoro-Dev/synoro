import {
  and,
  Booking,
  type Database,
  eq,
  gt,
  ImportBatch,
  ImportBatchItem,
  isExclusionViolation,
  PracticeClient,
} from "@synoro/db";
import { strFromU8 } from "fflate";

import { loadImportFile } from "./apply-file";
import { decodeText, FileProblem } from "./parse";

/**
 * Future events of a calendar, from an ICS file or Google. Only what a booking
 * needs is read: the title and the time, not descriptions or guests.
 */

export interface ImportEvent {
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  /** A repeat rule we couldn't read: only its first date was taken. */
  partial?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Repeats are written out this far ahead. */
const HORIZON_MS = 366 * DAY_MS;
const MAX_REPEATS = 400;
/** Dates looked at across one file. */
const MAX_RULE_STEPS = 200_000;
/** Forty years of months, for a rule whose date rarely or never comes. */
const MAX_MONTH_STEPS = 480;
const MAX_EVENTS = 20_000;
/** Longer than this is a trip or a mistake, not a meeting. */
const MAX_LENGTH_MS = 24 * 60 * 60 * 1000;
const TITLE_MAX = 120;

/** Wall-clock parts of a date and time, in some zone. */
interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function offsetAt(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(at);
  const part = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
  );
  return local - Math.floor(at.getTime() / 60_000) * 60_000;
}

/** The instant a wall clock in `timeZone` shows these parts. */
function wallToDate(wall: Wall, timeZone: string) {
  const utc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
  );
  const first = new Date(utc - offsetAt(new Date(utc), timeZone));
  return new Date(utc - offsetAt(first, timeZone));
}

function validZone(zone: string | undefined, fallback: string) {
  if (!zone) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    // Outlook writes zones like «Russian Standard Time».
    return fallback;
  }
}

interface Prop {
  value: string;
  params: Record<string, string>;
}

function unescapeText(text: string) {
  return text
    .replace(/\\n/gi, " ")
    .replace(/\\([,;\\])/g, "$1")
    .trim();
}

function parseWhen(prop: Prop, fallbackZone: string) {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z)?)?$/.exec(
    prop.value.trim(),
  );
  if (!match) return null;
  const wall: Wall = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
  };
  const allDay = match[4] === undefined;
  const zone =
    match[6] === "Z" ? "UTC" : validZone(prop.params.TZID, fallbackZone);
  return { wall, zone, allDay, at: wallToDate(wall, zone) };
}

/** `PT1H30M`, `P1D`: milliseconds. */
function parseDuration(value: string) {
  const match =
    /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      value.trim(),
    );
  if (!match) return null;
  const [, weeks, days, hours, minutes, seconds] = match;
  return (
    (Number(weeks ?? 0) * 7 + Number(days ?? 0)) * DAY_MS +
    Number(hours ?? 0) * 3_600_000 +
    Number(minutes ?? 0) * 60_000 +
    Number(seconds ?? 0) * 1000
  );
}

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function addDays(wall: Wall, days: number): Wall {
  const at = new Date(
    Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day + days,
      wall.hour,
      wall.minute,
    ),
  );
  return {
    year: at.getUTCFullYear(),
    month: at.getUTCMonth() + 1,
    day: at.getUTCDate(),
    hour: at.getUTCHours(),
    minute: at.getUTCMinutes(),
  };
}

/**
 * The same day some months on, or null if that month has no such day: RFC 5545
 * skips those, so the 31st repeats in March and May, never in April.
 */
function addMonths(wall: Wall, months: number): Wall | null {
  const at = new Date(Date.UTC(wall.year, wall.month - 1 + months, wall.day));
  if (at.getUTCDate() !== wall.day) return null;
  return { ...wall, year: at.getUTCFullYear(), month: at.getUTCMonth() + 1 };
}

/**
 * The starts of a repeating event. DAILY, WEEKLY (with BYDAY), MONTHLY and
 * YEARLY on the start's date, with INTERVAL, COUNT and UNTIL: what calendars
 * write for a standing appointment. Anything fancier is null, and the caller
 * takes the first date and says so.
 *
 * COUNT counts from the start, past dates too, as the rule means it; what comes
 * out is only what's still ahead of `now`, however long ago the series began.
 */
function expandRule(
  rule: string,
  start: { wall: Wall; zone: string; at: Date },
  now: Date,
  until: Date,
  lengthMs: number,
  budget: { steps: number },
): Date[] | null {
  const parts = new Map(
    rule.split(";").map((part) => part.split("=") as [string, string]),
  );
  const known = new Set([
    "FREQ",
    "INTERVAL",
    "COUNT",
    "UNTIL",
    "BYDAY",
    "WKST",
  ]);
  if ([...parts.keys()].some((key) => !known.has(key))) return null;

  const freq = parts.get("FREQ");
  const interval = Number(parts.get("INTERVAL") ?? 1);
  const limit = parts.has("COUNT") ? Number(parts.get("COUNT")) : null;
  const byDay = parts.get("BYDAY")?.split(",");
  // The week's start decides which days share a week when INTERVAL skips some.
  const weekStart = WEEKDAYS.indexOf(parts.get("WKST") ?? "MO");
  if (!(interval >= 1) || (byDay && freq !== "WEEKLY")) return null;
  if (limit !== null && !(limit >= 1)) return null;
  if (weekStart < 0 || byDay?.some((day) => !WEEKDAYS.includes(day))) {
    return null;
  }

  const end = parts.get("UNTIL")
    ? parseWhen({ value: parts.get("UNTIL") ?? "", params: {} }, start.zone)?.at
    : undefined;
  const stop = end && end < until ? end : until;

  const out: Date[] = [];
  let seen = 0;
  /** False once there's nothing more to look for. */
  const push = (wall: Wall) => {
    // Shared across the file: thousands of ancient rules must not stall a request.
    if (--budget.steps < 0) return false;
    const at = wallToDate(wall, start.zone);
    if (at > stop) return false;
    if (at < start.at) return true;
    seen++;
    if (limit !== null && seen > limit) return false;
    // One still going counts as ahead; one that ended stays behind.
    if (at.getTime() + lengthMs > now.getTime()) out.push(at);
    return out.length < MAX_REPEATS;
  };

  if (freq === "WEEKLY") {
    const startDay = new Date(
      Date.UTC(start.wall.year, start.wall.month - 1, start.wall.day),
    ).getUTCDay();
    // Days as offsets from the first day of the week, whichever that is.
    const fromWeekStart = (day: number) => (day - weekStart + 7) % 7;
    const days = byDay?.map((day) => WEEKDAYS.indexOf(day)) ?? [startDay];
    const sorted = [...new Set(days.map(fromWeekStart))].sort((a, b) => a - b);
    let week = addDays(start.wall, -fromWeekStart(startDay));
    while (true) {
      for (const offset of sorted) {
        if (!push(addDays(week, offset))) return out;
      }
      week = addDays(week, 7 * interval);
    }
  }
  if (freq === "DAILY") {
    for (let n = 0; ; n++) {
      if (!push(addDays(start.wall, n * interval))) return out;
    }
  }
  if (freq === "MONTHLY" || freq === "YEARLY") {
    const step = freq === "YEARLY" ? 12 : 1;
    for (let n = 0; ; n++) {
      const wall = addMonths(start.wall, n * interval * step);
      // A long way past any date: a day that never comes can't loop forever.
      if (n > MAX_MONTH_STEPS) return out;
      if (wall && !push(wall)) return out;
    }
  }
  return null;
}

/** The start of the day `days` after the one `at` falls on, in `zone`. */
function dayAfter(at: Date, zone: string, days: number) {
  const local = new Date(at.getTime() + offsetAt(at, zone));
  return wallToDate(
    addDays(
      {
        year: local.getUTCFullYear(),
        month: local.getUTCMonth() + 1,
        day: local.getUTCDate(),
        hour: 0,
        minute: 0,
      },
      days,
    ),
    zone,
  );
}

/** Every event of an ICS text, repeats written out, cancelled ones left out. */
function parseIcs(text: string, zone: string, now: Date): ImportEvent[] {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const until = new Date(now.getTime() + HORIZON_MS);
  const budget = { steps: MAX_RULE_STEPS };

  const blocks: Map<string, Prop[]>[] = [];
  let current: Map<string, Prop[]> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = new Map();
    } else if (line === "END:VEVENT") {
      if (current) blocks.push(current);
      current = null;
    } else if (current) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const [rawName, ...rawParams] = line.slice(0, colon).split(";");
      const name = rawName?.toUpperCase() ?? "";
      const params = Object.fromEntries(
        rawParams.map((param) => {
          const [key, value] = param.split("=");
          return [key?.toUpperCase() ?? "", value?.replace(/^"|"$/g, "") ?? ""];
        }),
      );
      const props = current.get(name) ?? [];
      props.push({ value: line.slice(colon + 1), params });
      current.set(name, props);
    }
  }

  // A moved occurrence is an event of its own, and takes its date off the rule.
  const moved = new Map<string, Set<number>>();
  for (const block of blocks) {
    const uid = block.get("UID")?.[0]?.value;
    const id = block.get("RECURRENCE-ID")?.[0];
    const when = id && parseWhen(id, zone);
    if (uid && when) {
      const set = moved.get(uid) ?? new Set();
      set.add(when.at.getTime());
      moved.set(uid, set);
    }
  }

  const events: ImportEvent[] = [];
  for (const block of blocks) {
    if (events.length >= MAX_EVENTS) break;
    const status = block.get("STATUS")?.[0]?.value.trim().toUpperCase();
    if (status === "CANCELLED") continue;

    const startProp = block.get("DTSTART")?.[0];
    const start = startProp && parseWhen(startProp, zone);
    if (!start) continue;
    const endProp = block.get("DTEND")?.[0];
    const end = endProp && parseWhen(endProp, zone);
    const duration = block.get("DURATION")?.[0];
    const length = end
      ? end.at.getTime() - start.at.getTime()
      : duration
        ? (parseDuration(duration.value) ?? 0)
        : start.allDay
          ? DAY_MS
          : 0;
    if (length <= 0) continue;

    const title = unescapeText(block.get("SUMMARY")?.[0]?.value ?? "").slice(
      0,
      TITLE_MAX,
    );
    const skip = new Set<number>(moved.get(block.get("UID")?.[0]?.value ?? ""));
    for (const ex of block.get("EXDATE") ?? []) {
      for (const value of ex.value.split(",")) {
        const when = parseWhen({ value, params: ex.params }, zone);
        if (when) skip.add(when.at.getTime());
      }
    }

    const rule = block.get("RRULE")?.[0]?.value;
    const isOverride = block.has("RECURRENCE-ID");
    const starts =
      rule && !isOverride
        ? expandRule(rule, start, now, until, length, budget)
        : [start.at];
    const partial = rule !== undefined && starts === null;
    // Whole days end at a local midnight: a day with a clock change isn't 24 h.
    const days = Math.max(1, Math.round(length / DAY_MS));
    for (const at of starts ?? [start.at]) {
      if (!isOverride && skip.has(at.getTime())) continue;
      events.push({
        title,
        startsAt: at,
        endsAt: start.allDay
          ? dayAfter(at, start.zone, days)
          : new Date(at.getTime() + length),
        allDay: start.allDay,
        ...(partial ? { partial } : {}),
      });
    }
  }
  return events;
}

/** A batch's file: an ICS, or the events a Google import stored as JSON. */
export function readEvents(bytes: Uint8Array, zone: string, now: Date) {
  const { text } = decodeText(bytes);
  const head = text.trimStart().slice(0, 15).toUpperCase();
  if (head === "BEGIN:VCALENDAR") return parseIcs(text, zone, now);
  try {
    const { events } = JSON.parse(strFromU8(bytes)) as {
      events: {
        title: string;
        startsAt: string;
        endsAt: string;
        allDay: boolean;
      }[];
    };
    // A whole day comes as a date, and starts at midnight in the practice's zone.
    const moment = (value: string, allDay: boolean) => {
      const match = allDay ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
      return match
        ? wallToDate(
            {
              year: Number(match[1]),
              month: Number(match[2]),
              day: Number(match[3]),
              hour: 0,
              minute: 0,
            },
            zone,
          )
        : new Date(value);
    };
    return events.map((event) => ({
      ...event,
      startsAt: moment(event.startsAt, event.allDay),
      endsAt: moment(event.endsAt, event.allDay),
    }));
  } catch {
    throw new FileProblem("Не получилось прочитать календарь");
  }
}

export type EventResult = ImportEvent & {
  status: "new" | "past" | "conflict" | "all-day" | "too-long";
};

/** Half-open ranges: one ending as the next starts don't overlap. */
function overlaps(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
) {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/**
 * What each event would become. Only the future goes in; a time already taken
 * is a conflict, by the same rule as `bookings_no_overlap`. An all-day event is
 * a closed day if events go in as closed time; as a booking it makes no sense.
 */
export function analyzeEvents(
  events: ImportEvent[],
  busy: { startsAt: Date; endsAt: Date }[],
  eventsAs: "bookings" | "blocked",
  now: Date,
): EventResult[] {
  const taken = [...busy];
  const sorted = [...events].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
  return sorted.map((event) => {
    const status = ((): EventResult["status"] => {
      if (event.endsAt <= now) return "past";
      if (event.allDay && eventsAs === "bookings") return "all-day";
      if (
        !event.allDay &&
        event.endsAt.getTime() - event.startsAt.getTime() > MAX_LENGTH_MS
      ) {
        return "too-long";
      }
      if (taken.some((range) => overlaps(range, event))) return "conflict";
      taken.push(event);
      return "new";
    })();
    return { ...event, status };
  });
}

export async function loadBusy(db: Database, practiceId: string, now: Date) {
  return db
    .select({ startsAt: Booking.startsAt, endsAt: Booking.endsAt })
    .from(Booking)
    .where(
      and(
        eq(Booking.practiceId, practiceId),
        eq(Booking.status, "active"),
        gt(Booking.endsAt, now),
      ),
    );
}

/**
 * Write the events as bookings or closed time. A booking carries the title as
 * the guest's name and links to the card of that name, if there is one; no
 * account means no reminders, and it isn't sent to Google, where it may have
 * come from. One at a time: an overlap that appeared meanwhile only loses that
 * event, and a rerun finds what's written as a conflict and adds nothing twice.
 */
export async function applyCalendar(
  db: Database,
  batchId: string,
  eventsAs: "bookings" | "blocked",
  now = new Date(),
) {
  const batch = await db.query.ImportBatch.findFirst({
    where: eq(ImportBatch.id, batchId),
  });
  const file = await loadImportFile(db, batchId);
  if (!batch || !file) throw new Error(`Import ${batchId} has no file`);
  const practice = await db.query.Practice.findFirst({
    where: (table, { eq }) => eq(table.id, batch.practiceId),
    columns: { timezone: true },
  });
  const zone = practice?.timezone ?? "Europe/Moscow";

  const results = analyzeEvents(
    readEvents(file, zone, now),
    await loadBusy(db, batch.practiceId, now),
    eventsAs,
    now,
  );

  const cards = await db
    .select({
      id: PracticeClient.id,
      name: PracticeClient.name,
      phone: PracticeClient.phone,
    })
    .from(PracticeClient)
    .where(eq(PracticeClient.practiceId, batch.practiceId));
  const cardByName = new Map(
    cards.map((card) => [card.name.toLowerCase(), card]),
  );

  let added = 0;
  let skipped = 0;
  let done = 0;
  for (const event of results) {
    done++;
    if (event.status !== "new") {
      skipped++;
      continue;
    }
    const card = cardByName.get(event.title.toLowerCase());
    try {
      await db.transaction(async (tx) => {
        const [booking] = await tx
          .insert(Booking)
          .values(
            eventsAs === "blocked"
              ? {
                  practiceId: batch.practiceId,
                  kind: "blocked",
                  startsAt: event.startsAt,
                  endsAt: event.endsAt,
                  note: event.title || null,
                  createdById: batch.createdById,
                }
              : {
                  practiceId: batch.practiceId,
                  kind: "consultation",
                  startsAt: event.startsAt,
                  endsAt: event.endsAt,
                  guestName: event.title || "Запись из календаря",
                  clientId: card?.id ?? null,
                  guestPhone: card?.phone ?? null,
                  createdById: batch.createdById,
                },
          )
          .returning({ id: Booking.id });
        if (!booking) throw new Error("Failed to insert booking");
        await tx.insert(ImportBatchItem).values({
          batchId,
          entity: "booking",
          entityId: booking.id,
          action: "added",
        });
      });
      added++;
    } catch (error) {
      if (!isExclusionViolation(error, "bookings_no_overlap")) throw error;
      skipped++;
    }
    if (done % 100 === 0) {
      await db
        .update(ImportBatch)
        .set({ progress: done })
        .where(eq(ImportBatch.id, batchId));
    }
  }
  return { added, merged: 0, skipped, errors: 0 };
}
