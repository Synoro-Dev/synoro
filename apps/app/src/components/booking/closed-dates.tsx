"use client";

import { Button, Skeleton } from "@synoro/ui";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import { useQuery } from "@tanstack/react-query";
import { CalendarOffIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { BookingDialog, type CalendarBooking } from "./booking-dialog";
import { EntryDialog, type EntryDraft } from "./entry-dialog";
import { ErrorState } from "./states";
import { dateKey } from "./time";
import { describeClosed } from "./time-ranges";

/** How far ahead closed time is listed (the calendar's limit). */
const SPAN_DAYS = 62;

/**
 * Closed time still ahead: a vacation, days off, the hours taken for oneself.
 * Closes dates here as in the calendar; a row opens to reopen them.
 */
export function ClosedDates({
  practiceId,
  timezone,
}: {
  practiceId: string;
  timezone: string;
}) {
  const now = new Date();
  const calendar = useQuery(
    orpc.booking.calendar.queryOptions({
      input: { practiceId, from: dateKey(now, timezone), days: SPAN_DAYS },
    }),
  );
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [selected, setSelected] = useState<CalendarBooking | null>(null);
  const closed = (calendar.data ?? []).filter(
    (b) => b.kind === "blocked" && b.endsAt > now,
  );

  return (
    <Frame spacing="default" className="max-w-3xl min-w-0">
      <FramePanel className="flex flex-col gap-4">
        <FrameHeader className="flex-row flex-wrap items-start justify-between gap-3 p-0">
          <div className="flex min-w-0 flex-col gap-0.5">
            <FrameTitle>Закрытые даты</FrameTitle>
            <FrameDescription>
              Отпуск, выходные, праздники: на это время никто не запишется
            </FrameDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const start = new Date();
              setDraft({
                mode: "block",
                start,
                end: new Date(start.getTime() + 60 * 60_000),
                wholeDays: true,
              });
            }}
          >
            <CalendarOffIcon />
            Закрыть даты
          </Button>
        </FrameHeader>
        {calendar.isError ? (
          <ErrorState onRetry={() => calendar.refetch()} />
        ) : calendar.isPending ? (
          <Skeleton className="h-16 w-full rounded-md" />
        ) : closed.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            В ближайшие два месяца всё открыто.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {closed.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setSelected(b)}
                  className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-medium">
                      {describeClosed(b.startsAt, b.endsAt, timezone)}
                    </span>
                    {b.note && (
                      <span className="truncate text-muted-foreground">
                        {b.note}
                      </span>
                    )}
                  </span>
                  <ChevronRightIcon
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </FramePanel>
      <EntryDialog
        practiceId={practiceId}
        timezone={timezone}
        draft={draft}
        onClose={() => setDraft(null)}
      />
      <BookingDialog booking={selected} onClose={() => setSelected(null)} />
    </Frame>
  );
}
