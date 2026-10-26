"use client";

import type { RouterOutputs } from "@acme/api";
import { paths } from "@acme/config";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  toast,
} from "@acme/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import {
  dateKey,
  formatDateTime,
  formatDayHeading,
  formatTime,
  groupIntoDays,
} from "./time";
import { WEEK_DAYS, WeekNav } from "./week-nav";

type PublicPractice = RouterOutputs["practice"]["bySlug"];

/**
 * The client's booking page: free one-hour slots of the week; booking spends
 * one paid consultation. Anonymous visitors see the slots and a sign-in link.
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
  const [from, setFrom] = useState(today);
  const [selected, setSelected] = useState<Date | null>(null);

  const { data: info } = useQuery({
    ...orpc.practice.bySlug.queryOptions({ input: { slug: practice.slug } }),
    initialData: practice,
  });
  const membership = info.membership;
  const credits = membership?.credits ?? 0;

  const slots = useQuery(
    orpc.booking.slots.queryOptions({
      input: { practiceId: practice.id, from, days: WEEK_DAYS },
    }),
  );

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.booking.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.practice.key() }),
    ]);

  const join = useMutation({
    ...orpc.practice.join.mutationOptions(),
    onSuccess: async () => {
      toast.success(
        "Вы записаны как клиент. Администратор добавит оплаченные консультации.",
      );
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const book = useMutation({
    ...orpc.booking.book.mutationOptions(),
    onSuccess: async (booking) => {
      toast.success(`Вы записаны на ${formatDateTime(booking.startsAt)}`);
      setSelected(null);
      await refresh();
    },
    onError: async (error) => {
      // NO_CREDITS / SLOT_UNAVAILABLE carry a user-facing message.
      toast.error(error.message || "Не удалось записаться");
      setSelected(null);
      await refresh();
    },
  });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 md:p-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{practice.name}</h1>
        <p className="text-muted-foreground">
          Запись на консультацию, 1 час. Отменить запись и вернуть консультацию
          можно не позднее чем за 24 часа.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ваш баланс</CardTitle>
          <CardDescription>
            {membership
              ? "Каждая запись списывает одну оплаченную консультацию."
              : "Чтобы записаться, войдите и станьте клиентом специалиста."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {membership ? (
            <>
              <Badge variant={credits > 0 ? "default" : "destructive"}>
                Оплачено консультаций: {credits}
              </Badge>
              {credits === 0 && (
                <span className="text-sm text-muted-foreground">
                  Оплаченных консультаций нет — обратитесь к администратору.
                </span>
              )}
              <Button
                size="sm"
                variant="link"
                nativeButton={false}
                render={<Link href={paths.booking.mine} />}
              >
                Мои записи
              </Button>
            </>
          ) : signedIn ? (
            <Button
              disabled={join.isPending}
              onClick={() => join.mutate({ practiceId: practice.id })}
            >
              Стать клиентом
            </Button>
          ) : (
            <Button
              nativeButton={false}
              render={<Link href={paths.auth.login} />}
            >
              Войти
            </Button>
          )}
        </CardContent>
      </Card>

      <WeekNav from={from} minFrom={today} onChange={setFrom} />

      {slots.isPending ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {groupIntoDays(slots.data?.slots ?? [], from, WEEK_DAYS).map(
            ([day, daySlots]) => (
              <div key={day} className="flex flex-col gap-2">
                <h3 className="text-sm font-medium first-letter:uppercase">
                  {formatDayHeading(day)}
                </h3>
                {daySlots.length === 0 && (
                  <p className="text-xs text-muted-foreground">Нет записи</p>
                )}
                {daySlots.map((slot) => {
                  const active =
                    selected?.getTime() === slot.startsAt.getTime();
                  return (
                    <Button
                      key={slot.startsAt.toISOString()}
                      size="sm"
                      variant={active ? "default" : "outline"}
                      disabled={!membership || credits === 0}
                      onClick={() => setSelected(active ? null : slot.startsAt)}
                    >
                      {formatTime(slot.startsAt)}–{formatTime(slot.endsAt)}
                    </Button>
                  );
                })}
              </div>
            ),
          )}
        </div>
      )}

      {selected && (
        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-4 shadow-lg">
          <span className="text-sm">
            Консультация: <strong>{formatDateTime(selected)}</strong> · спишется
            1 из {credits}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setSelected(null)}>
              Отмена
            </Button>
            <Button
              disabled={book.isPending}
              onClick={() =>
                book.mutate({ practiceId: practice.id, startsAt: selected })
              }
            >
              {book.isPending ? "Запись…" : "Записаться"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
