import { describe, expect, test } from "bun:test";

import { describeClosed } from "./time-ranges";

const MOSCOW = "Europe/Moscow";
const at = (iso: string) => new Date(iso);

describe("describeClosed", () => {
  test("one whole day", () => {
    expect(
      describeClosed(
        at("2026-11-12T00:00:00+03:00"),
        at("2026-11-13T00:00:00+03:00"),
        MOSCOW,
      ),
    ).toBe("12 ноября");
  });

  test("several whole days name the last one, inclusive", () => {
    expect(
      describeClosed(
        at("2026-11-12T00:00:00+03:00"),
        at("2026-11-15T00:00:00+03:00"),
        MOSCOW,
      ),
    ).toBe("с 12 по 14 ноября");
  });

  test("whole days across months name both", () => {
    expect(
      describeClosed(
        at("2026-11-29T00:00:00+03:00"),
        at("2026-12-03T00:00:00+03:00"),
        MOSCOW,
      ),
    ).toBe("с 29 ноября по 2 декабря");
  });

  test("hours of one day", () => {
    expect(
      describeClosed(
        at("2026-11-12T10:00:00+03:00"),
        at("2026-11-12T12:30:00+03:00"),
        MOSCOW,
      ),
    ).toBe("12 ноября, 10:00–12:30");
  });

  test("whole days stay whole in a :45 zone, rounded to half hours", () => {
    expect(
      describeClosed(
        // Midnight in Kathmandu (+05:45) is 18:15 UTC, rounded out by the form.
        at("2026-11-11T18:00:00Z"),
        at("2026-11-12T18:30:00Z"),
        "Asia/Kathmandu",
      ),
    ).toBe("12 ноября");
  });
});
