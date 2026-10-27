"use client";

import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Separator,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@synoro/ui";
import { Badge } from "@synoro/ui/reui/badge";
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import {
  type AvailabilityRuleValues,
  availabilityFormSchema,
} from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDaysIcon,
  ChevronDownIcon,
  ClipboardPasteIcon,
  CopyIcon,
  EraserIcon,
  LayoutTemplateIcon,
  MousePointerClickIcon,
  Redo2Icon,
  RotateCcwIcon,
  SunIcon,
  Undo2Icon,
} from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { orpc } from "~/orpc/react";
import {
  type Cell,
  type CellRect,
  cellIndex,
  countChanged,
  DAYS,
  dayIntervals,
  daySlots,
  emptyGrid,
  fillRect,
  gridFromRules,
  gridStats,
  pasteDay,
  presetGrid,
  rectFrom,
  rulesFromGrid,
  SLOT_MINUTES,
  SLOTS_PER_DAY,
  type SlotGrid,
  toggleRect,
} from "./slot-grid";
import { ErrorState, PageHeading } from "./states";
import { minutesToTime, WEEKDAY_NAMES } from "./time";

const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEKDAYS = [0, 1, 2, 3, 4];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WORKDAY: [number, number] = [540, 1080];
const HISTORY_LIMIT = 100;

const PRESETS: { label: string; grid: () => SlotGrid }[] = [
  { label: "Будни 09:00–18:00", grid: () => presetGrid(WEEKDAYS, [WORKDAY]) },
  {
    label: "Будни 10:00–19:00",
    grid: () => presetGrid(WEEKDAYS, [[600, 1140]]),
  },
  {
    label: "Будни 09–13 и 14–18, с обедом",
    grid: () =>
      presetGrid(WEEKDAYS, [
        [540, 780],
        [840, 1080],
      ]),
  },
  {
    label: "Каждый день 10:00–20:00",
    grid: () => presetGrid(ALL_DAYS, [[600, 1200]]),
  },
];

/** Visible rows, in slots: working hours or the whole day. */
const VIEWS = {
  work: { label: "07–23", start: 14, end: 46 },
  full: { label: "24 ч", start: 0, end: SLOTS_PER_DAY },
} as const;
type View = keyof typeof VIEWS;

interface Drag {
  anchor: Cell;
  current: Cell;
  /** Open the cells (true) or close them; set by the cell the drag began on. */
  value: boolean;
}

const formatHours = (minutes: number) =>
  `${(minutes / 60).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ч`;

const dayRange = (rect: CellRect) =>
  rect.day0 === rect.day1
    ? DAY_SHORT[rect.day0]
    : `${DAY_SHORT[rect.day0]}–${DAY_SHORT[rect.day1]}`;

const timeRange = (rect: CellRect) =>
  `${minutesToTime(rect.slot0 * SLOT_MINUTES)}–${minutesToTime((rect.slot1 + 1) * SLOT_MINUTES)}`;

const sameCell = (a: Cell, b: Cell) => a.day === b.day && a.slot === b.slot;

function cellAt(x: number, y: number): Cell | null {
  const el = document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>("[data-cell]");
  if (!el) return null;
  return { day: Number(el.dataset.day), slot: Number(el.dataset.slot) };
}

/** Undo/redo over whole grids: every edit is one step. */
function useGridHistory(initial: SlotGrid) {
  const [state, setState] = useState({
    past: [] as SlotGrid[],
    present: initial,
    future: [] as SlotGrid[],
  });
  return {
    grid: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    commit: (edit: (grid: SlotGrid) => SlotGrid) =>
      setState((s) => {
        const next = edit(s.present);
        if (countChanged(s.present, next) === 0) return s;
        return {
          past: [...s.past, s.present].slice(-HISTORY_LIMIT),
          present: next,
          future: [],
        };
      }),
    undo: () =>
      setState((s) => {
        const previous = s.past.at(-1);
        if (!previous) return s;
        return {
          past: s.past.slice(0, -1),
          present: previous,
          future: [s.present, ...s.future],
        };
      }),
    redo: () =>
      setState((s) => {
        const [next, ...future] = s.future;
        if (!next) return s;
        return { past: [...s.past, s.present], present: next, future };
      }),
  };
}

/**
 * Weekly working hours as a paintable grid: drag across half-hour cells to
 * open or close them, Shift-click to extend, arrow keys + Space from the
 * keyboard, per-day copy/paste, presets and undo. Saves merged intervals.
 */
export function AvailabilityEditor({
  practiceId,
  timezone,
}: {
  practiceId: string;
  timezone: string;
}) {
  const rules = useQuery(
    orpc.availability.list.queryOptions({ input: { practiceId } }),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Расписание"
        description={`Часы приёма по времени ${timezone}`}
      />
      {rules.isError ? (
        <ErrorState onRetry={() => rules.refetch()} />
      ) : rules.isPending ? (
        <Skeleton className="h-[640px] w-full rounded-xl" />
      ) : (
        // Keyed by the saved rules, so a refetch after saving resets the draft.
        <SlotEditor
          key={JSON.stringify(rules.data)}
          practiceId={practiceId}
          initial={rules.data}
        />
      )}
    </div>
  );
}

function SlotEditor({
  practiceId,
  initial,
}: {
  practiceId: string;
  initial: AvailabilityRuleValues[];
}) {
  const queryClient = useQueryClient();
  const [saved] = useState(() => gridFromRules(initial));
  const { grid, canUndo, canRedo, commit, undo, redo } = useGridHistory(saved);
  const [view, setView] = useState<View>(() =>
    initial.every((r) => r.startMinute >= 420 && r.endMinute <= 1380)
      ? "work"
      : "full",
  );
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const [cursor, setCursor] = useState<Cell>({ day: 0, slot: 18 });
  const [anchor, setAnchor] = useState<Cell>({ day: 0, slot: 18 });
  const [keyboard, setKeyboard] = useState(false);
  const [lastPaint, setLastPaint] = useState<Drag | null>(null);
  const [clipboard, setClipboard] = useState<{
    day: number;
    slots: boolean[];
  } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const { start: viewStart, end: viewEnd } = VIEWS[view];
  const rows = Array.from(
    { length: viewEnd - viewStart },
    (_, i) => viewStart + i,
  );
  const dragRect = drag ? rectFrom(drag.anchor, drag.current) : null;
  const selection = keyboard && !drag ? rectFrom(anchor, cursor) : null;
  // While dragging, show the grid as it will be on release.
  const shown = drag && dragRect ? fillRect(grid, dragRect, drag.value) : grid;

  const changed = countChanged(saved, grid);
  const dirty = changed > 0;
  const stats = gridStats(shown);
  const delta = stats.minutes - gridStats(saved).minutes;

  const save = useMutation({
    ...orpc.availability.replace.mutationOptions(),
    onSuccess: async () => {
      toast.success("Расписание сохранено");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.availability.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.booking.key() }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  function onSave() {
    if (!dirty || save.isPending) return;
    const parsed = availabilityFormSchema.safeParse({
      rules: rulesFromGrid(grid),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Проверьте расписание");
      return;
    }
    save.mutate({ practiceId, rules: parsed.data.rules });
  }

  const onShortcut = useEffectEvent((e: globalThis.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (
      e.target instanceof HTMLElement &&
      e.target.closest("input, textarea, [contenteditable=true]")
    ) {
      return;
    }
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) undo();
    else if (key === "y" || (key === "z" && e.shiftKey)) redo();
    else if (key === "s") onSave();
    else return;
    e.preventDefault();
  });
  useEffect(() => {
    const listener = (e: globalThis.KeyboardEvent) => onShortcut(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function changeView(next: View) {
    setView(next);
    const clamp = (cell: Cell) => ({
      day: cell.day,
      slot: Math.min(
        VIEWS[next].end - 1,
        Math.max(VIEWS[next].start, cell.slot),
      ),
    });
    setCursor(clamp);
    setAnchor(clamp);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    e.preventDefault();
    bodyRef.current?.focus({ preventScroll: true });
    setKeyboard(false);
    setCursor(cell);
    setAnchor(cell);
    if (e.shiftKey && lastPaint) {
      const paint = { ...lastPaint, current: cell };
      commit((g) => fillRect(g, rectFrom(paint.anchor, cell), paint.value));
      setLastPaint(paint);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      anchor: cell,
      current: cell,
      value: !grid[cellIndex(cell.day, cell.slot)],
    });
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell) return;
    if (!hover || !sameCell(hover, cell)) setHover(cell);
    if (drag && !sameCell(drag.current, cell)) {
      setDrag({ ...drag, current: cell });
    }
  }

  function onPointerUp() {
    if (!drag) return;
    commit((g) => fillRect(g, rectFrom(drag.anchor, drag.current), drag.value));
    setLastPaint(drag);
    setCursor(drag.current);
    setAnchor(drag.current);
    setDrag(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    }[e.key];
    if (step) {
      e.preventDefault();
      const [dx = 0, dy = 0] = step;
      const next = {
        day: Math.min(DAYS - 1, Math.max(0, cursor.day + dx)),
        slot: Math.min(viewEnd - 1, Math.max(viewStart, cursor.slot + dy)),
      };
      setKeyboard(true);
      setCursor(next);
      if (!e.shiftKey) setAnchor(next);
      return;
    }
    const rect = rectFrom(anchor, cursor);
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      setKeyboard(true);
      commit((g) => toggleRect(g, rect));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      setKeyboard(true);
      commit((g) => fillRect(g, rect, false));
    } else if (e.key === "Escape") {
      setAnchor(cursor);
    }
  }

  const toggleRow = (slot: number) =>
    commit((g) =>
      toggleRect(g, { day0: 0, day1: DAYS - 1, slot0: slot, slot1: slot }),
    );
  const fillDay = (day: number, [from, to]: [number, number]) =>
    commit((g) =>
      fillRect(
        fillRect(g, { day0: day, day1: day, slot0: 0, slot1: 47 }, false),
        {
          day0: day,
          day1: day,
          slot0: from / SLOT_MINUTES,
          slot1: to / SLOT_MINUTES - 1,
        },
        true,
      ),
    );
  const applyDay = (day: number, days: number[]) =>
    commit((g) => pasteDay(g, daySlots(g, day), days));

  const status = (() => {
    if (drag && dragRect) {
      return `${drag.value ? "Открыть" : "Закрыть"} · ${dayRange(dragRect)} · ${timeRange(dragRect)}`;
    }
    if (selection) {
      return `Выделено: ${dayRange(selection)} · ${timeRange(selection)} — Пробел переключает, Delete закрывает`;
    }
    if (hover) {
      const cell = { day0: hover.day, day1: hover.day };
      const open = grid[cellIndex(hover.day, hover.slot)];
      return `${WEEKDAY_NAMES[hover.day]} · ${timeRange({ ...cell, slot0: hover.slot, slot1: hover.slot })} · ${open ? "приём" : "закрыто"}`;
    }
    return "Тяните по сетке, чтобы открыть или закрыть время";
  })();

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <Frame spacing="sm" className="min-w-0" stacked>
        <FramePanel className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Отменить"
              title="Отменить (Ctrl+Z)"
              disabled={!canUndo}
              onClick={undo}
            >
              <Undo2Icon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Повторить"
              title="Повторить (Ctrl+Shift+Z)"
              disabled={!canRedo}
              onClick={redo}
            >
              <Redo2Icon />
            </Button>
          </div>
          <Separator orientation="vertical" className="h-5" />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" />}
            >
              <LayoutTemplateIcon />
              Шаблоны
              <ChevronDownIcon className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Заменить всю неделю</DropdownMenuLabel>
                {PRESETS.map((preset) => (
                  <DropdownMenuItem
                    key={preset.label}
                    onClick={() => commit(preset.grid)}
                  >
                    <CalendarDaysIcon />
                    {preset.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => commit(emptyGrid)}
              >
                <EraserIcon />
                Очистить всю неделю
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[view]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "work" || next === "full") changeView(next);
            }}
          >
            {(Object.keys(VIEWS) as View[]).map((key) => (
              <ToggleGroupItem key={key} value={key} className="px-2.5">
                {VIEWS[key].label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <div className="ml-auto flex items-center gap-2">
            {dirty && (
              <Badge variant="warning-light" size="lg">
                Не сохранено · {changed}{" "}
                {changed === 1 ? "слот" : changed < 5 ? "слота" : "слотов"}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={!dirty || save.isPending}
              onClick={() => commit(() => saved)}
            >
              <RotateCcwIcon />
              Сбросить
            </Button>
            <Button
              size="sm"
              onClick={onSave}
              disabled={!dirty || save.isPending}
              title="Сохранить (Ctrl+S)"
            >
              {save.isPending ? "Сохранение…" : "Сохранить"}
            </Button>
          </div>
        </FramePanel>

        <FramePanel className="overflow-x-auto p-0">
          <div className="min-w-[40rem]">
            <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b">
              <div />
              {DAY_SHORT.map((short, day) => {
                const minutes = dayIntervals(shown, day).reduce(
                  (sum, [a, b]) => sum + b - a,
                  0,
                );
                return (
                  <div key={short} className="border-l p-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto w-full flex-col gap-0 py-1.5"
                            aria-label={`${WEEKDAY_NAMES[day]}: действия`}
                          />
                        }
                      >
                        <span className="text-sm font-medium">{short}</span>
                        <span className="text-xs font-normal text-muted-foreground tabular-nums">
                          {minutes ? formatHours(minutes) : "выходной"}
                        </span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-60">
                        <DropdownMenuGroup>
                          <DropdownMenuLabel>
                            {WEEKDAY_NAMES[day]}
                          </DropdownMenuLabel>
                          <DropdownMenuItem
                            onClick={() => fillDay(day, WORKDAY)}
                          >
                            <SunIcon />
                            Рабочий день 09:00–18:00
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setClipboard({
                                day,
                                slots: daySlots(grid, day),
                              })
                            }
                          >
                            <CopyIcon />
                            Скопировать день
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!clipboard}
                            onClick={() =>
                              clipboard &&
                              commit((g) => pasteDay(g, clipboard.slots, [day]))
                            }
                          >
                            <ClipboardPasteIcon />
                            Вставить
                            {clipboard && (
                              <DropdownMenuShortcut>
                                из {DAY_SHORT[clipboard.day]}
                              </DropdownMenuShortcut>
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuGroup>
                          <DropdownMenuLabel>
                            Повторить этот день
                          </DropdownMenuLabel>
                          <DropdownMenuItem
                            onClick={() => applyDay(day, WEEKDAYS)}
                          >
                            <CalendarDaysIcon />
                            На все будни
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => applyDay(day, ALL_DAYS)}
                          >
                            <CalendarDaysIcon />
                            На всю неделю
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() =>
                            commit((g) =>
                              fillRect(
                                g,
                                { day0: day, day1: day, slot0: 0, slot1: 47 },
                                false,
                              ),
                            )
                          }
                        >
                          <EraserIcon />
                          Сделать выходным
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>

            <div
              ref={bodyRef}
              role="application"
              aria-label="Сетка расписания: стрелки — перемещение, Shift+стрелки — выделение, Пробел — открыть или закрыть время"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: a keyboard-driven widget (arrows, Space, Delete), announced through the status line
              tabIndex={0}
              className="grid cursor-crosshair touch-none grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDrag(null)}
              onPointerLeave={() => setHover(null)}
              onKeyDown={onKeyDown}
              onBlur={() => setKeyboard(false)}
            >
              <div className="flex flex-col">
                {rows.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    tabIndex={-1}
                    title={`Открыть или закрыть ${minutesToTime(slot * SLOT_MINUTES)} на всех днях`}
                    onClick={() => toggleRow(slot)}
                    className={cn(
                      "h-5 cursor-pointer pr-2 text-right text-xs leading-none text-muted-foreground tabular-nums transition-colors hover:bg-muted hover:text-foreground",
                      slot % 2 === 0 && "pt-0.5",
                    )}
                  >
                    {slot % 2 === 0 && minutesToTime(slot * SLOT_MINUTES)}
                  </button>
                ))}
              </div>

              {DAY_SHORT.map((short, day) => (
                <DayColumn
                  key={short}
                  day={day}
                  rows={rows}
                  grid={shown}
                  viewStart={viewStart}
                  viewEnd={viewEnd}
                  drag={drag && dragRect ? { ...dragRect, ...drag } : null}
                  selection={selection}
                  cursor={keyboard ? cursor : null}
                />
              ))}
            </div>
          </div>
        </FramePanel>

        <FrameFooter className="flex-row items-center gap-2 text-xs text-muted-foreground">
          <MousePointerClickIcon className="size-3.5 shrink-0" />
          <span className="truncate" aria-live="polite">
            {status}
          </span>
        </FrameFooter>
      </Frame>

      <ScheduleSummary
        grid={shown}
        minutes={stats.minutes}
        delta={delta}
        paid={stats.paid}
        free={stats.free}
      />
    </div>
  );
}

function DayColumn({
  day,
  rows,
  grid,
  viewStart,
  viewEnd,
  drag,
  selection,
  cursor,
}: {
  day: number;
  rows: number[];
  grid: SlotGrid;
  viewStart: number;
  viewEnd: number;
  drag: (CellRect & { value: boolean }) | null;
  selection: CellRect | null;
  cursor: Cell | null;
}) {
  const span = viewEnd - viewStart;
  // Top and height in % of the visible rows, clipped to them.
  const place = (slot0: number, slot1: number) => {
    const a = Math.max(slot0, viewStart);
    const b = Math.min(slot1, viewEnd);
    if (b <= a) return null;
    return {
      top: `${((a - viewStart) / span) * 100}%`,
      height: `${((b - a) / span) * 100}%`,
      rows: b - a,
    };
  };
  const inRect = (rect: CellRect | null) =>
    rect && day >= rect.day0 && day <= rect.day1
      ? place(rect.slot0, rect.slot1 + 1)
      : null;
  const dragBox = inRect(drag);
  const selectionBox = inRect(selection);
  const cursorBox =
    cursor?.day === day ? place(cursor.slot, cursor.slot + 1) : null;

  return (
    <div className="relative border-l">
      {rows.map((slot) => (
        <div
          key={slot}
          data-cell=""
          data-day={day}
          data-slot={slot}
          className={cn(
            "h-5 transition-colors hover:bg-muted",
            slot !== viewStart &&
              (slot % 2 === 0
                ? "border-t"
                : "border-t border-dashed border-border/50"),
          )}
        />
      ))}

      {dayIntervals(grid, day).map(([start, end]) => {
        const box = place(start / SLOT_MINUTES, end / SLOT_MINUTES);
        if (!box) return null;
        return (
          <div
            key={start}
            className="pointer-events-none absolute inset-x-1 flex flex-col overflow-hidden rounded-md border border-l-[3px] border-success/25 border-l-success bg-success/15 px-1.5 py-0.5 text-xs text-success-foreground dark:border-success/30 dark:border-l-success dark:bg-success/20 dark:text-success"
            style={{ top: box.top, height: box.height }}
          >
            {box.rows >= 2 && (
              // Wraps after the dash in narrow columns instead of clipping.
              <span className="flex flex-wrap font-medium tabular-nums">
                <span>{minutesToTime(start)}–</span>
                <span>{minutesToTime(end)}</span>
              </span>
            )}
            {box.rows >= 4 && (
              <span className="truncate opacity-75">
                {formatHours(end - start)}
              </span>
            )}
          </div>
        );
      })}

      {dragBox && drag && (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0.5 rounded-md border-2 border-dashed",
            drag.value
              ? "border-success"
              : "border-destructive bg-destructive/10",
          )}
          style={{ top: dragBox.top, height: dragBox.height }}
        />
      )}
      {selectionBox && (
        <div
          className="pointer-events-none absolute inset-x-0.5 rounded-md border-2 border-primary/60 bg-primary/5"
          style={{ top: selectionBox.top, height: selectionBox.height }}
        />
      )}
      {cursorBox && (
        <div
          className="pointer-events-none absolute inset-x-0.5 rounded-sm ring-2 ring-primary"
          style={{ top: cursorBox.top, height: cursorBox.height }}
        />
      )}
    </div>
  );
}

function ScheduleSummary({
  grid,
  minutes,
  delta,
  paid,
  free,
}: {
  grid: SlotGrid;
  minutes: number;
  delta: number;
  paid: number;
  free: number;
}) {
  return (
    <Frame spacing="sm" className="min-w-0 self-start">
      <FramePanel className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">В неделю</span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight tabular-nums">
              {formatHours(minutes)}
            </span>
            {delta !== 0 && (
              <Badge
                variant={delta > 0 ? "success-light" : "destructive-light"}
              >
                {delta > 0 ? "+" : "−"}
                {formatHours(Math.abs(delta))}
              </Badge>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-0.5 rounded-md border px-2.5 py-2">
            <span className="text-lg font-semibold tabular-nums">{paid}</span>
            <span className="text-xs text-muted-foreground">
              платных по 1 ч
            </span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-md border px-2.5 py-2">
            <span className="text-lg font-semibold tabular-nums">{free}</span>
            <span className="text-xs text-muted-foreground">
              бесплатных по 30 мин
            </span>
          </div>
        </div>
      </FramePanel>

      <FramePanel className="flex flex-col gap-2 p-0">
        <FrameHeader>
          <FrameTitle>По дням</FrameTitle>
        </FrameHeader>
        <ul className="flex flex-col pb-2">
          {DAY_SHORT.map((short, day) => {
            const intervals = dayIntervals(grid, day);
            return (
              <li
                key={short}
                className="flex items-start gap-3 px-3 py-1.5 text-sm"
              >
                <span className="w-6 shrink-0 font-medium">{short}</span>
                {intervals.length ? (
                  <span className="flex flex-wrap gap-1">
                    {intervals.map(([a, b]) => (
                      <Badge key={a} variant="outline" className="tabular-nums">
                        {minutesToTime(a)}–{minutesToTime(b)}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  <span className="text-muted-foreground">выходной</span>
                )}
              </li>
            );
          })}
        </ul>
      </FramePanel>

      <FramePanel className="flex flex-col gap-2 p-0">
        <FrameHeader>
          <FrameTitle>Быстрые приёмы</FrameTitle>
          <FrameDescription className="text-xs">
            Зелёное — клиенты могут записаться
          </FrameDescription>
        </FrameHeader>
        <dl className="flex flex-col gap-1.5 px-3 pb-3 text-xs">
          {[
            ["Тянуть", "открыть или закрыть область"],
            ["Shift + клик", "продолжить от прошлой точки"],
            ["Клик по времени", "строка на всех днях"],
            ["Клик по дню", "копировать, шаблон, выходной"],
            ["← ↑ → ↓", "курсор, с Shift — выделение"],
            ["Пробел / Delete", "открыть / закрыть выделенное"],
            ["Ctrl + Z / S", "отменить / сохранить"],
          ].map(([keys, action]) => (
            <div key={keys} className="flex items-center justify-between gap-2">
              <dt>
                <Badge variant="outline" size="sm" className="font-mono">
                  {keys}
                </Badge>
              </dt>
              <dd className="text-right text-muted-foreground">{action}</dd>
            </div>
          ))}
        </dl>
      </FramePanel>
    </Frame>
  );
}
