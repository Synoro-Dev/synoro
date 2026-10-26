"use client";

import { Button, Skeleton } from "@acme/ui";
import { EventCalendar } from "@acme/ui/reui/event-calendar/event-calendar";
import { EventCalendarContent } from "@acme/ui/reui/event-calendar/event-calendar-content";
import { EventCalendarNav } from "@acme/ui/reui/event-calendar/event-calendar-nav";
import type { CalendarEvent } from "@acme/ui/reui/event-calendar/event-calendar-types";
import { Frame, FramePanel } from "@acme/ui/reui/frame";
import { useQuery } from "@tanstack/react-query";
import { addDays, startOfWeek } from "date-fns";
import { ru } from "date-fns/locale";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import {
  BookingDialog,
  bookingTitle,
  type CalendarBooking,
  KIND_META,
} from "./booking-dialog";
import { calendarI18n } from "./calendar-i18n";
import { EntryDialog, type EntryDraft } from "./entry-dialog";
import { ErrorState } from "./states";
import { dateKey, viewerTimeZone } from "./time";

const DAY_MS = 24 * 60 * 60 * 1000;

interface Rule {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/** Minutes of [from, to) not covered by `rules`, as [start, end) pairs. */
function offHours(rules: Rule[], from: number, to: number) {
  const gaps: [number, number][] = [];
  let cursor = from;
  for (const r of [...rules].sort((a, b) => a.startMinute - b.startMinute)) {
    if (r.startMinute > cursor)
      gaps.push([cursor, Math.min(r.startMinute, to)]);
    cursor = Math.max(cursor, r.endMinute);
  }
  if (cursor < to) gaps.push([cursor, to]);
  return gaps.filter(([a, b]) => b > a);
}

function nextHalfHour() {
  const at = new Date();
  at.setSeconds(0, 0);
  at.setMinutes(at.getMinutes() < 30 ? 30 : 60);
  return at;
}

/**
 * The specialist's calendar on the ReUI event calendar: every booking, free
 * consultation and block. Drag across empty time to add a free consultation
 * or close the time; click an entry for details and cancel actions.
 */
export function PracticeCalendar({
  practiceId,
  timezone,
}: {
  practiceId: string;
  timezone: string;
}) {
  const [range, setRange] = useState(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 });
    return { start, end: new Date(start.getTime() + 7 * DAY_MS) };
  });
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [selected, setSelected] = useState<CalendarBooking | null>(null);

  const from = dateKey(addDays(range.start, -1));
  const days = Math.min(
    62,
    Math.max(
      1,
      Math.ceil((range.end.getTime() - range.start.getTime()) / DAY_MS) + 2,
    ),
  );
  const bookings = useQuery({
    ...orpc.booking.calendar.queryOptions({
      input: { practiceId, from, days },
    }),
    placeholderData: (previous) => previous,
  });
  const rules = useQuery(
    orpc.availability.list.queryOptions({ input: { practiceId } }),
  );

  // Working hours are stored in the practice zone; shade them only when the
  // viewer is in it too, otherwise the overlay would be shifted.
  const sameZone = viewerTimeZone() === timezone;
  const ruleList = rules.data ?? [];
  const dayStartHour = ruleList.length
    ? Math.max(
        0,
        Math.floor(Math.min(...ruleList.map((r) => r.startMinute)) / 60) - 1,
      )
    : 8;
  const dayEndHour = ruleList.length
    ? Math.min(
        24,
        Math.ceil(Math.max(...ruleList.map((r) => r.endMinute)) / 60) + 1,
      )
    : 20;

  const events: CalendarEvent<CalendarBooking>[] = (bookings.data ?? []).map(
    (b) => ({
      id: b.id,
      title: bookingTitle(b),
      start: b.startsAt,
      end: b.endsAt,
      color: KIND_META[b.kind].color,
      readOnly: true,
      data: b,
    }),
  );

  if (bookings.isError) {
    return <ErrorState onRetry={() => bookings.refetch()} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          {(["consultation", "free", "blocked"] as const).map((kind) => (
            <span key={kind} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: KIND_META[kind].color }}
              />
              {KIND_META[kind].label}
            </span>
          ))}
          <span className="hidden sm:inline">
            Выделите время мышью, чтобы добавить запись
          </span>
        </div>
        <Button
          size="sm"
          onClick={() => {
            const start = nextHalfHour();
            setDraft({
              mode: "free",
              start,
              end: new Date(start.getTime() + 60 * 60_000),
            });
          }}
        >
          <PlusIcon />
          Новая запись
        </Button>
      </div>

      <Frame className="min-h-0 flex-1" spacing="sm">
        <FramePanel className="flex min-h-0 flex-1 flex-col p-0">
          {bookings.isPending && !bookings.data ? (
            <Skeleton className="h-[640px] w-full" />
          ) : (
            <EventCalendar<CalendarBooking>
              className="h-[calc(100svh-13rem)] min-h-[560px]"
              events={events}
              defaultView="week"
              views={["month", "week", "day", "agenda"]}
              locale={ru}
              weekStartsOn={1}
              i18n={calendarI18n}
              dayStartHour={dayStartHour}
              dayEndHour={dayEndHour}
              slotDuration={30}
              snapDuration={30}
              loading={bookings.isFetching}
              interactions={{ drag: false, resize: false, selectSlot: true }}
              onRangeChange={({ range: next }) =>
                setRange({ start: next.start, end: next.end })
              }
              onEventClick={(occurrence) =>
                setSelected(occurrence.event.data ?? null)
              }
              onSelectSlot={(slot) =>
                !slot.allDay &&
                setDraft({
                  mode:
                    slot.end.getTime() - slot.start.getTime() > 30 * 60_000
                      ? "block"
                      : "free",
                  start: slot.start,
                  end: slot.end,
                })
              }
              renderDayColumnBackground={({
                day,
                boundsStartMin,
                boundsEndMin,
              }) => {
                if (!sameZone || !rules.data) return null;
                const weekday = day.getDay() || 7;
                // Percentages of the visible hours, not of the whole day.
                const span = boundsEndMin - boundsStartMin;
                const dayRules = rules.data.filter(
                  (r) => r.weekday === weekday,
                );
                return offHours(dayRules, boundsStartMin, boundsEndMin).map(
                  ([a, b]) => (
                    <div
                      key={a}
                      className="absolute inset-x-0 bg-muted/60 bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--border)_6px_7px)] dark:bg-muted/30"
                      style={{
                        top: `${((a - boundsStartMin) / span) * 100}%`,
                        height: `${((b - a) / span) * 100}%`,
                      }}
                    />
                  ),
                );
              }}
            >
              <EventCalendarNav className="border-b px-3 py-2" />
              <EventCalendarContent />
            </EventCalendar>
          )}
        </FramePanel>
      </Frame>

      <EntryDialog
        practiceId={practiceId}
        draft={draft}
        onClose={() => setDraft(null)}
      />
      <BookingDialog booking={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
