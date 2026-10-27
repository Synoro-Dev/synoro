"use client";

import type { RouterOutputs } from "@synoro/api";
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
  ReceiptIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import {
  consultations,
  consultationWord,
  formatRub,
  PAYMENT_STATUS,
} from "../payment/format";
import { PaymentReturn } from "../payment/payment-return";
import { TopUpDialog } from "../payment/top-up-dialog";
import { ConfirmButton } from "./confirm-button";
import { EmptyState, ErrorState, PageHeading } from "./states";
import { formatDateTime, formatTime } from "./time";

type ClientPractice = RouterOutputs["practice"]["mine"][number];
type MyBooking = RouterOutputs["booking"]["mine"][number];

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

/**
 * One practice the user is a client of: the balance front and centre,
 * the next consultation, and the two things to do — top up, book.
 */
function BalanceCard({
  practice,
  next,
  onTopUp,
}: {
  practice: ClientPractice;
  next: MyBooking | undefined;
  onTopUp: () => void;
}) {
  const offer = useQuery(
    orpc.payment.packages.queryOptions({
      input: { practiceId: practice.practiceId },
    }),
  );
  const canPay = offer.data?.enabled ?? false;
  const empty = practice.credits === 0;

  return (
    <FramePanel className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <IconTile variant="soft" aria-hidden="true">
          {practice.name.charAt(0).toUpperCase()}
        </IconTile>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {practice.name}
        </span>
        {empty ? (
          <Badge variant="warning-light">Нужно пополнить</Badge>
        ) : practice.credits === 1 ? (
          <Badge variant="info-light">Осталась одна</Badge>
        ) : null}
      </div>

      <div className="flex flex-col gap-0.5">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">
          {practice.credits}
        </span>
        <span className="text-xs text-muted-foreground">
          {consultationWord(practice.credits)} оплачено
        </span>
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarCheckIcon className="size-3.5" />
        {next ? (
          <span className="first-letter:uppercase">
            Ближайшая: {formatDateTime(next.startsAt)}
          </span>
        ) : (
          "Ближайших записей нет"
        )}
      </p>

      <div className="mt-auto flex flex-wrap gap-2">
        {canPay && (
          <Button
            size="sm"
            variant={empty ? "default" : "outline"}
            onClick={onTopUp}
          >
            <WalletIcon />
            Пополнить
          </Button>
        )}
        <Button
          size="sm"
          variant={empty && canPay ? "outline" : "default"}
          nativeButton={false}
          render={<Link href={paths.booking.public(practice.slug)} />}
        >
          <CalendarPlusIcon />
          Записаться
        </Button>
      </div>
      {!canPay && empty && offer.isSuccess && (
        <p className="text-xs text-muted-foreground">
          Оплатите консультации специалисту — администратор добавит их на
          баланс.
        </p>
      )}
    </FramePanel>
  );
}

function PaymentHistory() {
  const payments = useQuery(orpc.payment.mine.queryOptions());

  if (payments.isError) {
    return <ErrorState onRetry={() => payments.refetch()} />;
  }
  if (payments.isPending) {
    return <Skeleton className="h-48 w-full rounded-xl" />;
  }
  if (payments.data.length === 0) {
    return (
      <Frame spacing="default">
        <FramePanel>
          <EmptyState
            icon={ReceiptIcon}
            title="Платежей нет"
            description="Здесь будут ваши оплаты консультаций онлайн."
          />
        </FramePanel>
      </Frame>
    );
  }

  return (
    <Frame spacing="default" stacked>
      {payments.data.map((p) => {
        const status = PAYMENT_STATUS[p.status];
        return (
          <FramePanel key={p.id} className="flex items-center gap-4">
            <DateChip at={p.createdAt} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">
                {consultations(p.credits)} · {formatRub(p.amount)}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {p.practiceName} · {p.providerName}
              </span>
            </div>
            {p.resumeUrl ? (
              <Button
                size="sm"
                nativeButton={false}
                render={<a href={p.resumeUrl} />}
              >
                Оплатить
              </Button>
            ) : (
              <Badge
                variant={p.status === "pending" ? "outline" : status.badge}
              >
                {p.status === "pending" ? "Не завершён" : status.label}
              </Badge>
            )}
          </FramePanel>
        );
      })}
    </Frame>
  );
}

/**
 * The client's cabinet: balances per practice with top-up, the
 * consultations (upcoming, past) and the payment history.
 */
export function MyBookings() {
  const queryClient = useQueryClient();
  const practices = useQuery(orpc.practice.mine.queryOptions());
  const bookings = useQuery(orpc.booking.mine.queryOptions());
  const [topUp, setTopUp] = useState<string | null>(null);

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
  const topUpPractice = clientOf.find((p) => p.practiceId === topUp);
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
        title="Кабинет"
        description="Баланс консультаций, записи и оплаты"
      />

      <PaymentReturn onRetry={setTopUp} />

      {practices.isError ? (
        <ErrorState onRetry={() => practices.refetch()} />
      ) : practices.isPending ? (
        <Skeleton className="h-44 w-full rounded-xl" />
      ) : clientOf.length === 0 ? null : (
        <Frame
          spacing="default"
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
        >
          {clientOf.map((p) => (
            <BalanceCard
              key={p.practiceId}
              practice={p}
              next={upcoming.find((b) => b.practiceId === p.practiceId)}
              onTopUp={() => setTopUp(p.practiceId)}
            />
          ))}
        </Frame>
      )}

      {topUpPractice && (
        <TopUpDialog
          practice={{ id: topUpPractice.practiceId, name: topUpPractice.name }}
          balance={topUpPractice.credits}
          open
          onOpenChange={(open) => !open && setTopUp(null)}
        />
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
          <TabsTrigger value="payments">Платежи</TabsTrigger>
        </TabsList>

        <TabsContent value="payments">
          <PaymentHistory />
        </TabsContent>

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
