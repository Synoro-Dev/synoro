import { describe, expect, test } from "bun:test";

import {
  addDays,
  formatWeekRange,
  hourSpan,
  isBookingView,
  weekDays,
  weekStart,
  weekWindow,
} from "./booking-views";

describe("booking views", () => {
  test("a week starts on Monday", () => {
    expect(weekStart("2026-11-03")).toBe("2026-11-02");
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });

  test("the week's days run Monday to Sunday across months", () => {
    expect(weekDays("2026-11-30")).toEqual([
      "2026-11-30",
      "2026-12-01",
      "2026-12-02",
      "2026-12-03",
      "2026-12-04",
      "2026-12-05",
      "2026-12-06",
    ]);
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
  });

  test("the slots window pads a day each side and skips past days", () => {
    expect(weekWindow("2026-11-09", "2026-11-03")).toEqual({
      from: "2026-11-08",
      days: 9,
    });
    // This week, from Tuesday: Monday is gone.
    expect(weekWindow("2026-11-02", "2026-11-03")).toEqual({
      from: "2026-11-02",
      days: 8,
    });
    expect(weekWindow("2026-11-02", "2026-11-08")).toEqual({
      from: "2026-11-07",
      days: 3,
    });
  });

  test("the week's title names the month once when it can", () => {
    expect(formatWeekRange("2026-11-02")).toBe("2–8 ноября");
    expect(formatWeekRange("2026-10-26")).toBe("26 октября – 1 ноября");
    expect(formatWeekRange("2026-12-28")).toBe(
      "28 декабря 2026 г. – 3 января 2027 г.",
    );
  });

  test("the grid's hours cover every slot, gaps included", () => {
    const at = (hour: number, minute = 0) =>
      new Date(2026, 10, 3, hour, minute);
    expect(hourSpan([])).toEqual([]);
    expect(hourSpan([at(14), at(10, 30), at(12)])).toEqual([
      10, 11, 12, 13, 14,
    ]);
  });

  test("only known views are read back", () => {
    expect(isBookingView("week")).toBe(true);
    expect(isBookingView("day")).toBe(false);
    expect(isBookingView(null)).toBe(false);
  });
});
