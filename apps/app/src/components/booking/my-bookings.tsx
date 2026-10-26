"use client";

import { paths } from "@synoro/config";
import {
  Button,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@synoro/ui";
import { Badge } from "@synoro/ui/reui/badge";
import { Frame, FramePanel } from "@synoro/ui/reui/frame";
import { IconTile } from "@synoro/ui/reui/icon-tile";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarCheckIcon,
  CalendarPlusIcon,
  CalendarXIcon,
} from "lucide-react";
import Link from "next/link";

import { orpc } from "~/orpc/react";
import { ConfirmButton } from "./confirm-button";
import { EmptyState, ErrorState, PageHeading } from "./states";
import { formatTime } from "./time";

function DateChip({ at }: { at: Date }) {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center rounded-md border py-1 leading-none">
      <span className="text-[0.625rem] font-medium text-muted-foreground uppercase">
        {at.toLocaleDateString("ru-RU", { month: "short" })}
      </span>
      <span className="text-lg font-semibold tabular-nums">{at.getDate()}</span>
    </div>
  );
}

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
          ? "Отменено, консультация вернулась на баланс"
          : "Запись отменена",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.booking.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.practice.key() }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  const clientOf = practices.data?.filter((p) => p.role === "client") ?? [];
  const now = Date.now();
  const upcoming =
    bookings.data?.filter(
      (b) => b.status === "active" && b.endsAt.getTime() > now,
    ) ?? [];
  const past = (
    bookings.data?.filter(
      (b) => b.status !== "active" || b.endsAt.getTime() <= now,
    ) ?? []
  ).reverse();

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Мои записи"
        description="Консультации и оплаченный баланс"
      />

      {practices.isError ? (
        <ErrorState onRetry={() => practices.refetch()} />
      ) : practices.isPending ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : clientOf.length === 0 ? null : (
        <Frame
          spacing="default"
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
        >
          {clientOf.map((p) => (
            <FramePanel key={p.practiceId} className="flex items-center gap-3">
              <IconTile variant="soft" aria-hidden="true">
                {p.name.charAt(0).toUpperCase()}
              </IconTile>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground">
                  Оплачено:{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {p.credits}
                  </span>
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href={paths.booking.public(p.slug)} />}
              >
                <CalendarPlusIcon />
                Записаться
              </Button>
            </FramePanel>
          ))}
        </Frame>
      )}

      <Tabs defaultValue="upcoming" className="gap-4">
        <TabsList>
          <TabsTrigger value="upcoming">
            Предстоящие
            {upcoming.length > 0 && (
              <Badge variant="outline">{upcoming.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="past">Прошедшие</TabsTrigger>
        </TabsList>

        {bookings.isError ? (
          <ErrorState onRetry={() => bookings.refetch()} />
        ) : bookings.isPending ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : (
          <>
            <TabsContent value="upcoming">
              {upcoming.length === 0 ? (
                <Frame spacing="default">
                  <FramePanel>
                    <EmptyState
                      icon={CalendarCheckIcon}
                      title="Записей нет"
                      description={
                        clientOf.length
                          ? "Выберите удобное время у специалиста."
                          : "Откройте ссылку для записи, которую дал специалист."
                      }
                      action={
                        clientOf[0] && (
                          <Button
                            size="sm"
                            nativeButton={false}
                            render={
                              <Link
                                href={paths.booking.public(clientOf[0].slug)}
                              />
                            }
                          >
                            Записаться
                          </Button>
                        )
                      }
                    />
                  </FramePanel>
                </Frame>
              ) : (
                <Frame spacing="default" stacked>
                  {upcoming.map((b) => (
                    <FramePanel key={b.id} className="flex items-center gap-4">
                      <DateChip at={b.startsAt} />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm font-medium first-letter:uppercase">
                          {b.startsAt.toLocaleDateString("ru-RU", {
                            weekday: "long",
                          })}
                          , {formatTime(b.startsAt)}–{formatTime(b.endsAt)}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
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
                        <Badge variant="warning-light">Меньше 24 ч</Badge>
                      )}
                    </FramePanel>
                  ))}
                </Frame>
              )}
            </TabsContent>
            <TabsContent value="past">
              {past.length === 0 ? (
                <Frame spacing="default">
                  <FramePanel>
                    <EmptyState
                      icon={CalendarXIcon}
                      title="Пока пусто"
                      description="Здесь будут прошедшие и отменённые записи за 30 дней."
                    />
                  </FramePanel>
                </Frame>
              ) : (
                <Frame spacing="default" stacked>
                  {past.map((b) => (
                    <FramePanel key={b.id} className="flex items-center gap-4">
                      <DateChip at={b.startsAt} />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm font-medium tabular-nums">
                          {formatTime(b.startsAt)}–{formatTime(b.endsAt)}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {b.practiceName}
                        </span>
                      </div>
                      <Badge
                        variant={
                          b.status === "cancelled"
                            ? "destructive-light"
                            : "outline"
                        }
                      >
                        {b.status === "cancelled" ? "Отменена" : "Прошла"}
                      </Badge>
                    </FramePanel>
                  ))}
                </Frame>
              )}
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
