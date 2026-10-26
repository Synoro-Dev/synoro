"use client";

import type { RouterOutputs } from "@synoro/api";
import { paths } from "@synoro/config";
import { Button, Calendar, Card, Separator, Skeleton, toast } from "@synoro/ui";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import { Badge } from "@synoro/ui/reui/badge";
import { IconTile } from "@synoro/ui/reui/icon-tile";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  CalendarCheckIcon,
  CircleCheckIcon,
  Clock3Icon,
  GlobeIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { ErrorState } from "./states";
import { dateKey, formatDateTime, formatTime, viewerTimeZone } from "./time";

type PublicPractice = RouterOutputs["practice"]["bySlug"];
type Slot = { startsAt: Date; endsAt: Date };

/** From today (or the 1st) to month end, with a day of padding on each side. */
function monthWindow(month: Date, today: string) {
  const first = dateKey(new Date(month.getFullYear(), month.getMonth(), 1));
  const last = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const from = new Date(
    Date.parse(`${first < today ? today : first}T00:00:00Z`) - 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  const days =
    Math.round(
      (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000,
    ) + 2;
  return { from, days: Math.max(1, Math.min(33, days)) };
}

const keyToDate = (key: string) => new Date(`${key}T12:00:00`);

/**
 * The client's booking page, cal.com style: practice details, a month with
 * the bookable days, and the free hours of the chosen day. Booking spends
 * one paid consultation.
 */
export function PublicBooking({
  practice,
  signedIn,
}: {
  practice: PublicPractice;
  signedIn: boolean;
}) {
  const queryClient = useQueryClient();
  const today = dateKey(new Date(), practice.timezone);
  const [month, setMonth] = useState(() => keyToDate(today));
  const [day, setDay] = useState<string | null>(null);
  const [picked, setPicked] = useState<Slot | null>(null);
  const [booked, setBooked] = useState<Date | null>(null);

  const { data: info } = useQuery({
    ...orpc.practice.bySlug.queryOptions({ input: { slug: practice.slug } }),
    initialData: practice,
  });
  // Staff see their own page as a preview; only clients book here.
  const isStaff = !!info.membership && info.membership.role !== "client";
  const membership = isStaff ? null : info.membership;
  const credits = membership?.credits ?? 0;
  const canBook = !!membership && credits > 0;

  const range = monthWindow(month, today);
  const slots = useQuery({
    ...orpc.booking.slots.queryOptions({
      input: { practiceId: practice.id, from: range.from, days: range.days },
    }),
    placeholderData: (previous) => previous,
  });

  const byDay = new Map<string, Slot[]>();
  const monthStart = dateKey(
    new Date(month.getFullYear(), month.getMonth(), 1),
  );
  const monthEnd = dateKey(
    new Date(month.getFullYear(), month.getMonth() + 1, 0),
  );
  const viewerToday = dateKey(new Date());
  for (const slot of slots.data?.slots ?? []) {
    const key = dateKey(slot.startsAt);
    if (key < monthStart || key > monthEnd || key < viewerToday) continue;
    byDay.set(key, [...(byDay.get(key) ?? []), slot]);
  }
  // Default to the first day with free time once slots arrive.
  const firstFree = [...byDay.keys()].sort()[0] ?? null;
  const selectedDay = day && byDay.has(day) ? day : firstFree;
  const daySlots = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.booking.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.practice.key() }),
    ]);

  const join = useMutation({
    ...orpc.practice.join.mutationOptions(),
    onSuccess: async () => {
      toast.success(
        "Вы клиент. Администратор добавит оплаченные консультации.",
      );
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const book = useMutation({
    ...orpc.booking.book.mutationOptions(),
    onSuccess: async (booking) => {
      setBooked(booking.startsAt);
      setPicked(null);
      await refresh();
    },
    onError: async (error) => {
      // NO_CREDITS / SLOT_UNAVAILABLE carry a user-facing message.
      toast.error(error.message || "Не удалось записаться");
      setPicked(null);
      await refresh();
    },
  });

  return (
    <main className="flex min-h-svh items-start justify-center bg-muted/40 px-4 py-8 md:items-center md:py-12 dark:bg-background">
      <Card className="w-full max-w-5xl gap-0 overflow-hidden p-0">
        <div className="grid md:grid-cols-[17rem_1fr] lg:grid-cols-[17rem_1fr_15rem]">
          {/* Practice */}
          <section className="flex flex-col gap-5 border-b p-6 md:border-r md:border-b-0">
            <IconTile variant="soft" size="lg" aria-hidden="true">
              {practice.name.charAt(0).toUpperCase()}
            </IconTile>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">
                {practice.name}
              </span>
              <h1 className="text-xl font-semibold tracking-tight">
                Консультация
              </h1>
            </div>
            <ul className="flex flex-col gap-3 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <Clock3Icon className="size-4" />1 час
              </li>
              <li className="flex items-center gap-2">
                <GlobeIcon className="size-4" />
                {viewerTimeZone()}
              </li>
              {membership && (
                <li className="flex items-center gap-2">
                  <WalletIcon className="size-4" />
                  <span>Оплачено:</span>
                  <Badge
                    variant={credits > 0 ? "success-light" : "warning-light"}
                  >
                    {credits}
                  </Badge>
                </li>
              )}
            </ul>
            <Separator />
            <p className="text-xs text-muted-foreground">
              Отменить запись и вернуть консультацию можно не позднее чем за 24
              часа до начала.
            </p>
            {membership && (
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={paths.booking.mine} />}
              >
                <CalendarCheckIcon />
                Мои записи
              </Button>
            )}
          </section>

          {booked ? (
            <section className="flex flex-col items-center justify-center gap-4 p-10 text-center lg:col-span-2">
              <IconTile variant="soft" size="xl" className="text-success">
                <CircleCheckIcon />
              </IconTile>
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold tracking-tight">
                  Вы записаны
                </h2>
                <p className="text-sm text-muted-foreground">
                  {formatDateTime(booked)}, 1 час · осталось оплаченных:{" "}
                  {credits}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={paths.booking.mine} />}
                >
                  Мои записи
                </Button>
                <Button onClick={() => setBooked(null)}>Записаться ещё</Button>
              </div>
            </section>
          ) : (
            <>
              {/* Month */}
              <section className="flex flex-col gap-4 border-b p-6 lg:border-r lg:border-b-0">
                <h2 className="text-sm font-semibold">Выберите день</h2>
                {slots.isError ? (
                  <ErrorState onRetry={() => slots.refetch()} />
                ) : (
                  <Calendar
                    mode="single"
                    locale={ru}
                    weekStartsOn={1}
                    month={month}
                    onMonthChange={setMonth}
                    startMonth={keyToDate(today)}
                    selected={selectedDay ? keyToDate(selectedDay) : undefined}
                    onSelect={(date) => {
                      if (date) setDay(dateKey(date));
                      setPicked(null);
                    }}
                    disabled={(date) => !byDay.has(dateKey(date))}
                    formatters={{
                      formatCaption: (date) => {
                        const caption = format(date, "LLLL yyyy", {
                          locale: ru,
                        });
                        return (
                          caption.charAt(0).toUpperCase() + caption.slice(1)
                        );
                      },
                    }}
                    modifiers={{
                      available: (date) => byDay.has(dateKey(date)),
                    }}
                    modifiersClassNames={{
                      available:
                        "[&>button]:bg-primary/10 [&>button]:font-semibold [&>button]:text-primary dark:[&>button]:bg-primary/20",
                    }}
                    className="mx-auto w-full max-w-sm p-0 [--cell-size:--spacing(10)]"
                  />
                )}
              </section>

              {/* Times */}
              <section className="flex min-h-72 flex-col gap-3 p-6 md:col-span-2 lg:col-span-1">
                <h2 className="text-sm font-semibold first-letter:uppercase">
                  {selectedDay
                    ? keyToDate(selectedDay).toLocaleDateString("ru-RU", {
                        weekday: "short",
                        day: "numeric",
                        month: "long",
                      })
                    : "Время"}
                </h2>

                {isStaff ? (
                  <Alert variant="info">
                    <AlertTitle>Предпросмотр</AlertTitle>
                    <AlertDescription>
                      Так страницу видят ваши клиенты.
                    </AlertDescription>
                  </Alert>
                ) : !signedIn ? (
                  <Alert variant="info">
                    <AlertTitle>Войдите, чтобы записаться</AlertTitle>
                    <AlertDescription className="flex flex-col items-start gap-2">
                      <span>Свободное время видно и без входа.</span>
                      <Button
                        size="sm"
                        nativeButton={false}
                        render={<Link href={paths.auth.login} />}
                      >
                        Войти
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : !membership ? (
                  <Alert variant="info">
                    <AlertTitle>Станьте клиентом</AlertTitle>
                    <AlertDescription className="flex flex-col items-start gap-2">
                      <span>Затем администратор добавит оплату.</span>
                      <Button
                        size="sm"
                        disabled={join.isPending}
                        onClick={() => join.mutate({ practiceId: practice.id })}
                      >
                        Стать клиентом
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : credits === 0 ? (
                  <Alert variant="warning">
                    <AlertTitle>Нет оплаты</AlertTitle>
                    <AlertDescription>
                      Обратитесь к администратору, чтобы оплатить.
                    </AlertDescription>
                  </Alert>
                ) : null}

                {slots.isPending && !slots.data ? (
                  <div className="flex flex-col gap-2">
                    {["a", "b", "c", "d"].map((k) => (
                      <Skeleton key={k} className="h-9 w-full" />
                    ))}
                  </div>
                ) : daySlots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    В этом месяце свободного времени нет
                  </p>
                ) : (
                  <div className="grid max-h-[26rem] grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2 overflow-y-auto pr-1 lg:grid-cols-1">
                    {daySlots.map((slot) => {
                      const active =
                        picked?.startsAt.getTime() === slot.startsAt.getTime();
                      return active ? (
                        <div
                          key={slot.startsAt.toISOString()}
                          className="col-span-2 grid grid-cols-2 gap-2 lg:col-span-1"
                        >
                          <Button
                            variant="secondary"
                            className="tabular-nums"
                            onClick={() => setPicked(null)}
                          >
                            {formatTime(slot.startsAt)}
                          </Button>
                          <Button
                            disabled={book.isPending}
                            onClick={() =>
                              book.mutate({
                                practiceId: practice.id,
                                startsAt: slot.startsAt,
                              })
                            }
                          >
                            Записаться
                          </Button>
                        </div>
                      ) : (
                        <Button
                          key={slot.startsAt.toISOString()}
                          variant="outline"
                          disabled={!canBook}
                          onClick={() => setPicked(slot)}
                          className="tabular-nums"
                        >
                          {formatTime(slot.startsAt)}
                        </Button>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </Card>
    </main>
  );
}
