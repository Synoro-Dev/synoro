"use client";

import {
  Button,
  cn,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from "@synoro/ui";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import { Badge } from "@synoro/ui/reui/badge";
import { Frame, FramePanel } from "@synoro/ui/reui/frame";
import { capitalize, formatMinutes } from "@synoro/validators";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarCheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  PhoneCallIcon,
  UserRoundPlusIcon,
} from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { EntryDialog, type EntryDraft } from "./entry-dialog";
import { ErrorState } from "./states";
import { useTerms } from "./terms";
import { dateKey, viewerTimeZone, viewerTimeZoneName } from "./time";

type Kind = "consultation" | "free";

/** YYYY-MM-DD plus `days`, on the calendar (no time zone involved). */
function shiftKey(key: string, days: number) {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Monday of the week `key` falls in. */
function mondayOf(key: string) {
  const weekday = new Date(`${key}T00:00:00Z`).getUTCDay() || 7;
  return shiftKey(key, 1 - weekday);
}

/** «пн, 3 ноября» for a YYYY-MM-DD key. */
function dayLabel(key: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("ru-RU", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "long",
    ...options,
  });
}

/** «Москва» for Europe/Moscow — the zone named in words; the id if unknown. */
function zoneName(timeZone: string) {
  try {
    const part = new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      timeZoneName: "shortGeneric",
    })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/**
 * «10:00» in the practice's zone: the days come from the practice's calendar,
 * so the times on them do too — and that is the time a caller is told.
 */
function timeIn(at: Date, timeZone: string) {
  return at.toLocaleTimeString("ru-RU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The specialist's free time, a week at a time, for whoever answers the
 * phone: per day the continuous free windows and the times a paid hour or a
 * free intro can start. A time opens the new-entry dialog for it (a client of
 * the practice from their balance, or a new person for the intro); «copy»
 * puts the week's free times into text for a messenger.
 */
export function PracticeWindows({
  practiceId,
  practiceName,
  timezone,
  introMinutes,
}: {
  practiceId: string;
  practiceName: string;
  timezone: string;
  /** How long the practice's free intro lasts. */
  introMinutes: number;
}) {
  const terms = useTerms();
  const today = dateKey(new Date(), timezone);
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [kind, setKind] = useState<Kind>("consultation");
  const [draft, setDraft] = useState<EntryDraft | null>(null);

  const windows = useQuery({
    ...orpc.booking.windows.queryOptions({
      input: { practiceId, from: weekStart, days: 7 },
    }),
    placeholderData: (previous) => previous,
    // Someone may book on the page meanwhile.
    refetchInterval: 60_000,
  });

  const lengthMinutes = kind === "consultation" ? 60 : introMinutes;
  const kindLabel =
    kind === "consultation"
      ? `${capitalize(terms.credit[0])}, 1 час`
      : `${terms.free}, ${formatMinutes(introMinutes)}, бесплатно`;
  const days = windows.data?.days ?? [];
  const next = days
    .flatMap((day) => day.slots[kind])
    .find((at) => at.getTime() > Date.now());
  const sameZone = viewerTimeZone() === timezone;
  const time = (at: Date) => timeIn(at, timezone);
  const span = (range: { startsAt: Date; endsAt: Date }) =>
    `${time(range.startsAt)}–${time(range.endsAt)}`;

  function book(at: Date) {
    setDraft({
      mode: kind,
      start: at,
      end: new Date(at.getTime() + lengthMinutes * 60_000),
    });
  }

  async function copy() {
    const lines = days
      .filter((day) => day.slots[kind].length > 0)
      .map(
        (day) =>
          `${dayLabel(day.date)}: ${day.slots[kind].map(time).join(", ")}`,
      );
    if (lines.length === 0) {
      toast.info("На этой неделе свободного времени нет");
      return;
    }
    const text = [
      `Свободное время — ${practiceName} (${kindLabel}).`,
      `Время — ${zoneName(timezone)}:`,
      ...lines,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Свободное время скопировано — вставьте его в сообщение");
    } catch {
      toast.info(text);
    }
  }

  if (windows.isError) {
    return <ErrorState onRetry={() => windows.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={kind} onValueChange={(value) => setKind(value as Kind)}>
          <TabsList>
            <TabsTrigger value="consultation">
              <CalendarCheckIcon />
              {capitalize(terms.credit[0])} · 1 ч
            </TabsTrigger>
            <TabsTrigger value="free">
              <UserRoundPlusIcon />
              {terms.free} · {formatMinutes(introMinutes, true)}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Предыдущая неделя"
            disabled={weekStart <= mondayOf(today)}
            onClick={() => setWeekStart(shiftKey(weekStart, -7))}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="min-w-36 text-center text-sm font-medium tabular-nums">
            {dayLabel(weekStart, { weekday: undefined })} –{" "}
            {dayLabel(shiftKey(weekStart, 6), { weekday: undefined })}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Следующая неделя"
            onClick={() => setWeekStart(shiftKey(weekStart, 7))}
          >
            <ChevronRightIcon />
          </Button>
          {weekStart !== mondayOf(today) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setWeekStart(mondayOf(today))}
            >
              Сегодня
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={copy}>
            <CopyIcon />
            Скопировать
          </Button>
        </div>
      </div>

      {!sameZone && (
        <Alert variant="info">
          <AlertTitle>Время — по поясу специалиста ({timezone})</AlertTitle>
          <AlertDescription suppressHydrationWarning>
            Вы в поясе «{viewerTimeZoneName()}»: в окне записи то же время
            показано по-вашему.
          </AlertDescription>
        </Alert>
      )}

      {windows.data && (
        <Alert variant={next ? "success" : "warning"}>
          <PhoneCallIcon />
          <AlertTitle>
            {next
              ? `Ближайшее свободное: ${dayLabel(dateKey(next, timezone))}, ${time(next)}`
              : "На этой неделе свободного времени нет"}
          </AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            {next ? (
              <>
                <span>{kindLabel}. Нажмите на время, чтобы записать.</span>
                <Button size="sm" onClick={() => book(next)}>
                  Записать на {time(next)}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setWeekStart(shiftKey(weekStart, 7))}
              >
                Следующая неделя
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Frame spacing="sm">
        {!windows.data
          ? ["a", "b", "c", "d", "e", "f", "g"].map((key) => (
              <FramePanel key={key}>
                <Skeleton className="h-12 w-full" />
              </FramePanel>
            ))
          : days.map((day) => {
              const slots = day.slots[kind];
              const past = day.date < today;
              return (
                <FramePanel
                  key={day.date}
                  className={cn(
                    "flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6",
                    past && "opacity-60",
                  )}
                >
                  <div className="flex w-44 shrink-0 flex-col gap-1">
                    <span className="flex items-center gap-2 text-sm font-medium first-letter:uppercase">
                      {dayLabel(day.date)}
                      {day.date === today && (
                        <Badge variant="primary-light">Сегодня</Badge>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {day.working.length === 0
                        ? "Выходной"
                        : past
                          ? "Прошло"
                          : day.free.length === 0
                            ? "Всё занято"
                            : `Свободно ${day.free.map(span).join(", ")}`}
                    </span>
                  </div>
                  {slots.length > 0 ? (
                    <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
                      {slots.map((at) => (
                        <Button
                          key={at.toISOString()}
                          variant="outline"
                          size="sm"
                          className="tabular-nums"
                          onClick={() => book(at)}
                        >
                          {time(at)}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    day.working.length > 0 &&
                    !past &&
                    day.free.length > 0 && (
                      <p className="text-sm text-muted-foreground">
                        {kind === "consultation"
                          ? "Окна короче часа или не с начала часа."
                          : `Окна короче, чем ${terms.free.toLowerCase()} (${formatMinutes(introMinutes)}).`}
                      </p>
                    )
                  )}
                </FramePanel>
              );
            })}
      </Frame>

      <EntryDialog
        practiceId={practiceId}
        timezone={timezone}
        draft={draft}
        onClose={() => setDraft(null)}
      />
    </div>
  );
}
