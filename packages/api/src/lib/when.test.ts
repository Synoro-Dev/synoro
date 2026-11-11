import { describe, expect, it } from "bun:test";

import {
  describeDates,
  formatClock,
  localHour,
  zoneName,
} from "@synoro/jobs/when";

// 2030-03-12 07:00Z: 10:00 in Moscow, 14:00 in Novosibirsk.
const AT = new Date("2030-03-12T07:00:00Z");

describe("zoneName", () => {
  it("names a zone by its place", () => {
    expect(zoneName(AT, "Europe/Moscow")).toBe("Москва");
    expect(zoneName(AT, "Asia/Novosibirsk")).toBe("Новосибирск");
  });
});

describe("describeDates", () => {
  it("writes one date in the given zone, with its name when asked", () => {
    const plain = describeDates([AT], "Asia/Novosibirsk");
    expect(plain.when).toContain("14:00");
    expect(plain.when).not.toContain("(");
    expect(plain.dates).toEqual([]);

    const named = describeDates([AT], "Asia/Novosibirsk", { named: true });
    expect(named.when).toBe(`${plain.when} (Новосибирск)`);
  });

  it("names the zone once for a series, after the first date", () => {
    const later = new Date(AT.getTime() + 7 * 24 * 60 * 60 * 1000);
    const { when, dates } = describeDates([later, AT], "Europe/Moscow", {
      named: true,
    });
    expect(when).toStartWith("2 встречи, первая — ");
    expect(when).toEndWith("10:00 (Москва)");
    expect(dates).toHaveLength(2);
    expect(dates.some((d) => d.includes("("))).toBe(false);
  });
});

describe("formatClock", () => {
  it("writes the time of day, with the zone when named", () => {
    expect(formatClock(AT, "Asia/Novosibirsk")).toBe("14:00");
    expect(formatClock(AT, "Asia/Novosibirsk", true)).toBe(
      "14:00 (Новосибирск)",
    );
  });
});

describe("localHour", () => {
  it("reads the hour on the wall clock of a zone", () => {
    expect(localHour(AT, "Europe/Moscow")).toBe(10);
    expect(localHour(AT, "Asia/Vladivostok")).toBe(17);
  });
});
