/**
 * The weekly schedule as a grid of half-hour cells: 7 days × 48 slots, `true`
 * where the practice accepts clients. Pure, so the editor's painting, copying
 * and presets are unit tested (`slot-grid.test.ts`); the API still stores
 * merged intervals (`AvailabilityRule`), converted at the edges.
 */

export const SLOT_MINUTES = 30;
export const SLOTS_PER_DAY = 1440 / SLOT_MINUTES;
export const DAYS = 7;

/** Index = (weekday - 1) * SLOTS_PER_DAY + slot. */
export type SlotGrid = readonly boolean[];

export interface Rule {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/** Inclusive cell rectangle: days and slots are 0-based. */
export interface CellRect {
  day0: number;
  day1: number;
  slot0: number;
  slot1: number;
}

export interface Cell {
  day: number;
  slot: number;
}

export const cellIndex = (day: number, slot: number) =>
  day * SLOTS_PER_DAY + slot;

export const emptyGrid = (): SlotGrid =>
  Array.from({ length: DAYS * SLOTS_PER_DAY }, () => false);

export function gridFromRules(rules: readonly Rule[]): SlotGrid {
  const grid = [...emptyGrid()];
  for (const r of rules) {
    for (let m = r.startMinute; m < r.endMinute; m += SLOT_MINUTES) {
      grid[cellIndex(r.weekday - 1, m / SLOT_MINUTES)] = true;
    }
  }
  return grid;
}

/** Runs of open cells of one day, as [startMinute, endMinute) pairs. */
export function dayIntervals(grid: SlotGrid, day: number) {
  const intervals: [number, number][] = [];
  let start: number | null = null;
  for (let slot = 0; slot <= SLOTS_PER_DAY; slot++) {
    const open = slot < SLOTS_PER_DAY && grid[cellIndex(day, slot)];
    if (open && start === null) start = slot;
    if (!open && start !== null) {
      intervals.push([start * SLOT_MINUTES, slot * SLOT_MINUTES]);
      start = null;
    }
  }
  return intervals;
}

/** Merged intervals, sorted by weekday and start — what the API stores. */
export function rulesFromGrid(grid: SlotGrid): Rule[] {
  return Array.from({ length: DAYS }, (_, day) =>
    dayIntervals(grid, day).map(([startMinute, endMinute]) => ({
      weekday: day + 1,
      startMinute,
      endMinute,
    })),
  ).flat();
}

export const rectFrom = (a: Cell, b: Cell): CellRect => ({
  day0: Math.min(a.day, b.day),
  day1: Math.max(a.day, b.day),
  slot0: Math.min(a.slot, b.slot),
  slot1: Math.max(a.slot, b.slot),
});

export function fillRect(
  grid: SlotGrid,
  rect: CellRect,
  value: boolean,
): SlotGrid {
  const next = [...grid];
  for (let day = rect.day0; day <= rect.day1; day++) {
    for (let slot = rect.slot0; slot <= rect.slot1; slot++) {
      next[cellIndex(day, slot)] = value;
    }
  }
  return next;
}

function isRectFilled(grid: SlotGrid, rect: CellRect) {
  for (let day = rect.day0; day <= rect.day1; day++) {
    for (let slot = rect.slot0; slot <= rect.slot1; slot++) {
      if (!grid[cellIndex(day, slot)]) return false;
    }
  }
  return true;
}

/** Fill the rectangle, or clear it when it is already fully open. */
export const toggleRect = (grid: SlotGrid, rect: CellRect) =>
  fillRect(grid, rect, !isRectFilled(grid, rect));

export function daySlots(grid: SlotGrid, day: number): boolean[] {
  return grid.slice(cellIndex(day, 0), cellIndex(day + 1, 0));
}

/** Replace each of `days` with `slots` (one day's column). */
export function pasteDay(
  grid: SlotGrid,
  slots: readonly boolean[],
  days: readonly number[],
): SlotGrid {
  const next = [...grid];
  for (const day of days) {
    for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
      next[cellIndex(day, slot)] = slots[slot] ?? false;
    }
  }
  return next;
}

/** A grid open on `days` during each [start, end) minute interval. */
export function presetGrid(
  days: readonly number[],
  intervals: readonly [number, number][],
): SlotGrid {
  return gridFromRules(
    days.flatMap((day) =>
      intervals.map(([startMinute, endMinute]) => ({
        weekday: day + 1,
        startMinute,
        endMinute,
      })),
    ),
  );
}

export const countChanged = (a: SlotGrid, b: SlotGrid) =>
  a.reduce((n, open, i) => (open === b[i] ? n : n + 1), 0);

/**
 * What the schedule offers in a week: open minutes, paid consultations (an
 * hour on the hour) and free ones (every half hour) — the slot grid of
 * `computeSlots` in `@synoro/api`.
 */
export function gridStats(grid: SlotGrid) {
  let open = 0;
  let paid = 0;
  for (let day = 0; day < DAYS; day++) {
    for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
      if (!grid[cellIndex(day, slot)]) continue;
      open++;
      if (slot % 2 === 0 && grid[cellIndex(day, slot + 1)]) paid++;
    }
  }
  return { minutes: open * SLOT_MINUTES, paid, free: open };
}
