import { describe, expect, it } from "bun:test";

import {
  addDays,
  computeSlots,
  isoWeekday,
  isScheduledSlot,
  toZonedDate,
  zonedTimeToUtc,
} from "./schedule";

const MSK = "Europe/Moscow";
// 2026-11-02 is a Monday.
const MONDAY = "2026-11-02";
const LONG_AGO = new Date("2000-01-01T00:00:00Z");

const iso = (slots: { startsAt: Date }[]) =>
  slots.map((s) => s.startsAt.toISOString());

describe("time zone helpers", () => {
  it("converts Moscow wall-clock time to UTC (+03:00, no DST)", () => {
    expect(zonedTimeToUtc(MONDAY, 10 * 60, MSK).toISOString()).toBe(
      "2026-11-02T07:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-07-01", 0, MSK).toISOString()).toBe(
      "2026-06-30T21:00:00.000Z",
    );
  });

  it("handles zones with DST", () => {
    // Berlin: CEST (+2) on 2026-10-24, CET (+1) after 2026-10-25.
    expect(
      zonedTimeToUtc("2026-10-24", 600, "Europe/Berlin").toISOString(),
    ).toBe("2026-10-24T08:00:00.000Z");
    expect(
      zonedTimeToUtc("2026-10-26", 600, "Europe/Berlin").toISOString(),
    ).toBe("2026-10-26T09:00:00.000Z");
  });

  it("reads the local date of an instant", () => {
    expect(toZonedDate(new Date("2026-11-01T22:30:00Z"), MSK)).toBe(MONDAY);
  });

  it("does calendar arithmetic", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(isoWeekday(MONDAY)).toBe(1);
    expect(isoWeekday("2026-11-08")).toBe(7);
  });
});

describe("computeSlots", () => {
  const rules = [{ weekday: 1, startMinute: 600, endMinute: 780 }]; // 10:00–13:00

  it("cuts paid consultations into whole hours", () => {
    const slots = computeSlots({
      rules,
      busy: [],
      from: MONDAY,
      days: 7,
      timeZone: MSK,
      kind: "consultation",
      now: LONG_AGO,
    });
    expect(iso(slots)).toEqual([
      "2026-11-02T07:00:00.000Z",
      "2026-11-02T08:00:00.000Z",
      "2026-11-02T09:00:00.000Z",
    ]);
    expect(slots[0]?.endsAt.toISOString()).toBe("2026-11-02T08:00:00.000Z");
  });

  it("cuts free consultations into half hours", () => {
    const slots = computeSlots({
      rules,
      busy: [],
      from: MONDAY,
      days: 1,
      timeZone: MSK,
      kind: "free",
      now: LONG_AGO,
    });
    expect(slots).toHaveLength(6);
    expect(slots[1]?.startsAt.toISOString()).toBe("2026-11-02T07:30:00.000Z");
  });

  it("keeps paid slots on the hour when a rule starts at :30", () => {
    const slots = computeSlots({
      rules: [{ weekday: 1, startMinute: 630, endMinute: 780 }], // 10:30–13:00
      busy: [],
      from: MONDAY,
      days: 1,
      timeZone: MSK,
      kind: "consultation",
      now: LONG_AGO,
    });
    expect(iso(slots)).toEqual([
      "2026-11-02T08:00:00.000Z",
      "2026-11-02T09:00:00.000Z",
    ]);
  });

  it("drops slots that overlap a booking or a block", () => {
    const slots = computeSlots({
      rules,
      busy: [
        // A free consultation 11:30–12:00 takes out the 11:00 paid hour.
        {
          startsAt: new Date("2026-11-02T08:30:00Z"),
          endsAt: new Date("2026-11-02T09:00:00Z"),
        },
      ],
      from: MONDAY,
      days: 1,
      timeZone: MSK,
      kind: "consultation",
      now: LONG_AGO,
    });
    expect(iso(slots)).toEqual([
      "2026-11-02T07:00:00.000Z",
      "2026-11-02T09:00:00.000Z",
    ]);
  });

  it("hides slots that already started", () => {
    const slots = computeSlots({
      rules,
      busy: [],
      from: MONDAY,
      days: 1,
      timeZone: MSK,
      kind: "consultation",
      now: new Date("2026-11-02T07:00:00Z"),
    });
    expect(slots).toHaveLength(2);
  });

  it("does not duplicate slots of overlapping rules", () => {
    const slots = computeSlots({
      rules: [...rules, { weekday: 1, startMinute: 660, endMinute: 840 }],
      busy: [],
      from: MONDAY,
      days: 1,
      timeZone: MSK,
      kind: "consultation",
      now: LONG_AGO,
    });
    expect(slots).toHaveLength(4);
  });
});

describe("isScheduledSlot", () => {
  const rules = [{ weekday: 1, startMinute: 600, endMinute: 780 }];
  const check = (startsAt: string, kind: "consultation" | "free") =>
    isScheduledSlot({
      rules,
      startsAt: new Date(startsAt),
      timeZone: MSK,
      kind,
      now: LONG_AGO,
    });

  it("accepts grid slots inside the schedule", () => {
    expect(check("2026-11-02T07:00:00Z", "consultation")).toBe(true);
    expect(check("2026-11-02T07:30:00Z", "free")).toBe(true);
  });

  it("rejects off-grid and out-of-schedule times", () => {
    expect(check("2026-11-02T07:30:00Z", "consultation")).toBe(false);
    expect(check("2026-11-02T10:00:00Z", "consultation")).toBe(false);
    expect(check("2026-11-03T07:00:00Z", "consultation")).toBe(false);
  });
});
