"use client";

import { Button } from "@acme/ui";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";

import { addDays, formatDayHeading, viewerTimeZone } from "./time";

export const WEEK_DAYS = 7;

/** "← 2 нояб. – 8 нояб. →" with the viewer's time zone underneath. */
export function WeekNav({
  from,
  minFrom,
  onChange,
}: {
  from: string;
  /** Earliest allowed start (today); going back past it is disabled. */
  minFrom: string;
  onChange: (from: string) => void;
}) {
  const to = addDays(from, WEEK_DAYS - 1);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Предыдущая неделя"
          disabled={from <= minFrom}
          onClick={() => {
            const prev = addDays(from, -WEEK_DAYS);
            onChange(prev < minFrom ? minFrom : prev);
          }}
        >
          <IconChevronLeft />
        </Button>
        <span className="min-w-44 text-center text-sm font-medium">
          {formatDayHeading(from)} – {formatDayHeading(to)}
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label="Следующая неделя"
          onClick={() => onChange(addDays(from, WEEK_DAYS))}
        >
          <IconChevronRight />
        </Button>
      </div>
      <p suppressHydrationWarning className="text-xs text-muted-foreground">
        Время указано по вашему часовому поясу ({viewerTimeZone()})
      </p>
    </div>
  );
}
