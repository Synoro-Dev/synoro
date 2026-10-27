import { describe, expect, test } from "bun:test";
import { availabilityFormSchema } from "@synoro/validators";

import {
  countChanged,
  daySlots,
  emptyGrid,
  fillRect,
  gridFromRules,
  gridStats,
  pasteDay,
  presetGrid,
  rectFrom,
  rulesFromGrid,
  toggleRect,
} from "./slot-grid";

describe("slot grid", () => {
  test("the form accepts the maximum number of separate grid intervals", () => {
    const grid = emptyGrid().map((_, slot) => slot % 2 === 0);
    const rules = rulesFromGrid(grid);
    expect(rules).toHaveLength(168);
    expect(availabilityFormSchema.safeParse({ rules }).success).toBe(true);
    expect(gridFromRules(rules)).toEqual(grid);
  });

  test("round-trips rules, merging adjacent intervals", () => {
    const grid = gridFromRules([
      { weekday: 1, startMinute: 600, endMinute: 720 },
      { weekday: 1, startMinute: 720, endMinute: 780 },
      { weekday: 7, startMinute: 1380, endMinute: 1440 },
    ]);
    expect(rulesFromGrid(grid)).toEqual([
      { weekday: 1, startMinute: 600, endMinute: 780 },
      { weekday: 7, startMinute: 1380, endMinute: 1440 },
    ]);
  });

  test("paints a rectangle across days in either drag direction", () => {
    const rect = rectFrom({ day: 2, slot: 21 }, { day: 0, slot: 20 });
    const rules = rulesFromGrid(fillRect(emptyGrid(), rect, true));
    expect(rules).toEqual(
      [1, 2, 3].map((weekday) => ({
        weekday,
        startMinute: 600,
        endMinute: 660,
      })),
    );
  });

  test("toggle clears a fully open rectangle and fills a partial one", () => {
    const rect = rectFrom({ day: 0, slot: 20 }, { day: 0, slot: 23 });
    const half = fillRect(emptyGrid(), { ...rect, slot1: 21 }, true);
    const full = toggleRect(half, rect);
    expect(rulesFromGrid(full)).toEqual([
      { weekday: 1, startMinute: 600, endMinute: 720 },
    ]);
    expect(rulesFromGrid(toggleRect(full, rect))).toEqual([]);
  });

  test("pastes one day onto others and counts the changes", () => {
    const monday = presetGrid([0], [[540, 1080]]);
    const week = pasteDay(monday, daySlots(monday, 0), [1, 2, 3, 4]);
    expect(rulesFromGrid(week)).toEqual(
      rulesFromGrid(presetGrid([0, 1, 2, 3, 4], [[540, 1080]])),
    );
    expect(countChanged(monday, week)).toBe(4 * 18);
  });

  test("counts paid slots on the hour and free ones per half hour", () => {
    // 10:30–13:00: free at 10:30…12:30 (5), paid at 11:00 and 12:00 (2).
    const grid = gridFromRules([
      { weekday: 1, startMinute: 630, endMinute: 780 },
    ]);
    expect(gridStats(grid)).toEqual({ minutes: 150, paid: 2, free: 5 });
  });
});
