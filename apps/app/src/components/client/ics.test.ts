import { describe, expect, test } from "bun:test";

import { bookingIcs } from "./ics";

describe("bookingIcs", () => {
  const booking = {
    id: "b1",
    startsAt: new Date("2026-11-05T15:00:00Z"),
    endsAt: new Date("2026-11-05T16:00:00Z"),
    practiceName: "Иванова, Петров; партнёры",
    videoUrl: null,
  };

  test("writes UTC times and escapes the summary", () => {
    const ics = bookingIcs(booking);
    expect(ics).toContain("DTSTART:20261105T150000Z");
    expect(ics).toContain("DTEND:20261105T160000Z");
    expect(ics).toContain("SUMMARY:Запись: Иванова\\, Петров\\; партнёры");
    expect(ics).not.toContain("LOCATION");
  });

  test("adds the video room when there is one", () => {
    const ics = bookingIcs({ ...booking, videoUrl: "https://telemost.ru/j/1" });
    expect(ics).toContain("URL:https://telemost.ru/j/1");
  });
});
