import { describe, expect, test } from "bun:test";

import { nextDate, zonedDayStart } from "./time";

describe("zonedDayStart", () => {
  test("is local midnight of the zone", () => {
    expect(zonedDayStart("2026-11-10", "Europe/Moscow").toISOString()).toBe(
      "2026-11-09T21:00:00.000Z",
    );
    expect(zonedDayStart("2026-11-10", "Asia/Novosibirsk").toISOString()).toBe(
      "2026-11-09T17:00:00.000Z",
    );
    expect(zonedDayStart("2026-11-10", "UTC").toISOString()).toBe(
      "2026-11-10T00:00:00.000Z",
    );
  });

  test("uses the day's own offset on either side of a DST change", () => {
    expect(zonedDayStart("2026-03-28", "Europe/Berlin").toISOString()).toBe(
      "2026-03-27T23:00:00.000Z",
    );
    expect(zonedDayStart("2026-03-30", "Europe/Berlin").toISOString()).toBe(
      "2026-03-29T22:00:00.000Z",
    );
  });

  test("begins at the jump where the clock skips midnight", () => {
    // Havana, 8 March 2026: 00:00 -05:00 jumps to 01:00 -04:00.
    expect(zonedDayStart("2026-03-08", "America/Havana").toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
  });

  test("keeps minutes of a :45 zone", () => {
    expect(zonedDayStart("2026-11-10", "Asia/Kathmandu").toISOString()).toBe(
      "2026-11-09T18:15:00.000Z",
    );
  });
});

describe("nextDate", () => {
  test("crosses months and years", () => {
    expect(nextDate("2026-11-30")).toBe("2026-12-01");
    expect(nextDate("2026-12-31")).toBe("2027-01-01");
  });
});
