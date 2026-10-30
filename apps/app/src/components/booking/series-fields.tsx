"use client";

import type { RouterOutputs } from "@synoro/api";
import {
  Checkbox,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@synoro/ui";
import { useQuery } from "@tanstack/react-query";

import { orpc } from "~/orpc/react";
import { ErrorState } from "./states";
import { formatDateTime } from "./time";

/** Most bookings one recurring booking makes (`SERIES_MAX` in the API). */
const SERIES_MAX = 12;

export interface Repeat {
  intervalWeeks: 1 | 2;
  count: number;
}

type SeriesDate = RouterOutputs["booking"]["seriesPreview"]["dates"][number];

const REPEAT_LABELS: Record<string, string> = {
  none: "Не повторять",
  "1": "Каждую неделю",
  "2": "Раз в две недели",
};

const STATUS_LABELS: Record<Exclude<SeriesDate["status"], "free">, string> = {
  past: "уже прошло",
  off_schedule: "вне рабочих часов",
  booked: "занято",
  google_busy: "занято в календаре",
};

/**
 * «Повторять»: how often and how many times. `max` is how many the balance
 * pays for; below two there is nothing to repeat — but a repeat chosen
 * earlier (another client was selected) can still be turned off.
 */
export function RepeatSelect({
  value,
  onChange,
  max,
  idPrefix,
}: {
  value: Repeat | null;
  onChange: (value: Repeat | null) => void;
  max: number;
  idPrefix: string;
}) {
  const limit = Math.min(max, SERIES_MAX);
  const counts = Array.from({ length: Math.max(limit - 1, 0) }, (_, i) =>
    String(i + 2),
  );
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-repeat`}>Повторять</Label>
        <Select
          items={REPEAT_LABELS}
          value={value ? String(value.intervalWeeks) : "none"}
          disabled={limit < 2 && !value}
          onValueChange={(next) =>
            onChange(
              next === "1" || next === "2"
                ? {
                    intervalWeeks: next === "1" ? 1 : 2,
                    count: Math.min(value?.count ?? 4, limit),
                  }
                : null,
            )
          }
        >
          <SelectTrigger id={`${idPrefix}-repeat`} className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(REPEAT_LABELS)
              .filter(([key]) => key === "none" || limit >= 2)
              .map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      {value && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-count`}>Раз</Label>
          <Select
            items={Object.fromEntries(counts.map((c) => [c, c]))}
            value={String(value.count)}
            onValueChange={(next) =>
              onChange({ ...value, count: Number(next) })
            }
          >
            <SelectTrigger id={`${idPrefix}-count`} className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {counts.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

/** The dates of a series with whether each can be booked. */
export function useSeriesPreview({
  practiceId,
  startsAt,
  repeat,
  memberId,
}: {
  practiceId: string;
  startsAt: Date | null;
  repeat: Repeat | null;
  memberId?: string;
}) {
  return useQuery({
    ...orpc.booking.seriesPreview.queryOptions({
      input: {
        practiceId,
        startsAt: startsAt ?? new Date(0),
        intervalWeeks: repeat?.intervalWeeks ?? 1,
        count: repeat?.count ?? 2,
        memberId,
      },
    }),
    enabled: startsAt !== null && repeat !== null,
  });
}

/**
 * What a series books: the free dates the user left checked, and the rest
 * to pass to `bookSeries` as `skip`.
 */
export function seriesChoice(dates: SeriesDate[], unchecked: Set<number>) {
  const chosen = dates.filter(
    (d) => d.status === "free" && !unchecked.has(d.startsAt.getTime()),
  );
  const chosenKeys = new Set(chosen.map((d) => d.startsAt.getTime()));
  return {
    chosen,
    skip: dates
      .filter((d) => !chosenKeys.has(d.startsAt.getTime()))
      .map((d) => d.startsAt),
  };
}

/**
 * The dates of a series as a checklist: free ones can be left out, the
 * others are shown with the reason and never booked.
 */
export function SeriesDateList({
  query,
  unchecked,
  onToggle,
  idPrefix,
}: {
  query: ReturnType<typeof useSeriesPreview>;
  unchecked: Set<number>;
  onToggle: (at: Date, checked: boolean) => void;
  idPrefix: string;
}) {
  if (query.isError) {
    return (
      <ErrorState
        message="Не удалось проверить даты."
        onRetry={() => query.refetch()}
      />
    );
  }
  if (!query.data) {
    return (
      <div className="flex flex-col gap-2">
        {["a", "b", "c"].map((k) => (
          <Skeleton key={k} className="h-5 w-56" />
        ))}
      </div>
    );
  }
  return (
    <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
      {query.data.dates.map((d) => {
        const key = d.startsAt.getTime();
        const id = `${idPrefix}-date-${key}`;
        const free = d.status === "free";
        return (
          <li key={key} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={id}
              checked={free && !unchecked.has(key)}
              disabled={!free}
              onCheckedChange={(checked) => onToggle(d.startsAt, checked)}
            />
            <label
              htmlFor={id}
              className={
                free
                  ? "tabular-nums"
                  : "text-muted-foreground tabular-nums line-through"
              }
            >
              {formatDateTime(d.startsAt)}
            </label>
            {d.status !== "free" && (
              <span className="text-xs text-muted-foreground">
                {STATUS_LABELS[d.status]}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
