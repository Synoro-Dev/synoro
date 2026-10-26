"use client";

import { paths } from "@acme/config";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  toast,
} from "@acme/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

import { orpc } from "~/orpc/react";
import { ConfirmButton } from "./confirm-button";
import { QueryError } from "./query-error";
import { formatDateTime, formatTime } from "./time";

/** The client's consultations across practices, with balances and cancel. */
export function MyBookings() {
  const queryClient = useQueryClient();
  const practices = useQuery(orpc.practice.mine.queryOptions());
  const bookings = useQuery(orpc.booking.mine.queryOptions());

  const cancel = useMutation({
    ...orpc.booking.cancel.mutationOptions(),
    onSuccess: async (result) => {
      toast.success(
        result.refunded
          ? "Запись отменена, консультация возвращена на баланс"
          : "Запись отменена",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.booking.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.practice.key() }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const clientOf = (practices.isSuccess ? practices.data : []).filter(
    (p) => p.role === "client",
  );
  const now = Date.now();
  const upcoming = (bookings.isSuccess ? bookings.data : []).filter(
    (b) => b.status === "active" && b.endsAt.getTime() > now,
  );
  const past = (bookings.isSuccess ? bookings.data : []).filter(
    (b) => b.status !== "active" || b.endsAt.getTime() <= now,
  );

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Оплаченные консультации</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {practices.isPending && <Skeleton className="h-8 w-64" />}
          {practices.isError && (
            <QueryError
              message="Не удалось загрузить оплаченные консультации."
              retry={() => practices.refetch()}
              isFetching={practices.isFetching}
            />
          )}
          {practices.isSuccess && clientOf.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Вы ещё не клиент ни одного специалиста — откройте его ссылку для
              записи.
            </p>
          )}
          {clientOf.map((p) => (
            <div
              key={p.practiceId}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span className="font-medium">{p.name}</span>
              <div className="flex items-center gap-2">
                <Badge variant={p.credits > 0 ? "default" : "secondary"}>
                  {p.credits}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={paths.booking.public(p.slug)} />}
                >
                  Записаться
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Предстоящие записи</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {bookings.isPending && <Skeleton className="h-12 w-full" />}
          {bookings.isError && (
            <QueryError
              message="Не удалось загрузить записи."
              retry={() => bookings.refetch()}
              isFetching={bookings.isFetching}
            />
          )}
          {bookings.isSuccess && upcoming.length === 0 && (
            <p className="text-sm text-muted-foreground">Записей нет.</p>
          )}
          {upcoming.map((b) => (
            <div
              key={b.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
            >
              <div className="flex flex-col">
                <span className="font-medium">
                  {formatDateTime(b.startsAt)}–{formatTime(b.endsAt)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {b.practiceName}
                </span>
              </div>
              {b.canCancel ? (
                <ConfirmButton
                  title="Отменить запись?"
                  description="Консультация вернётся на ваш баланс."
                  confirmLabel="Отменить запись"
                  disabled={cancel.isPending}
                  onConfirm={() => cancel.mutate({ bookingId: b.id })}
                >
                  Отменить
                </ConfirmButton>
              ) : (
                <span className="max-w-60 text-xs text-muted-foreground">
                  Меньше 24 часов до начала — отменить можно через
                  администратора
                </span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {past.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Прошедшие и отменённые (30 дней)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {past.map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span>
                  {formatDateTime(b.startsAt)} · {b.practiceName}
                </span>
                <Badge variant="outline">
                  {b.status === "cancelled" ? "Отменена" : "Прошла"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
