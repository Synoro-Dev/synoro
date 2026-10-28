"use client";

import { paths } from "@synoro/config";
import { Button, Card, Skeleton, Spinner, toast } from "@synoro/ui";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import { IconTile } from "@synoro/ui/reui/icon-tile";
import { formatCredits, professionTerms } from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClockIcon,
  CalendarPlusIcon,
  CalendarXIcon,
  CircleCheckIcon,
  Clock3Icon,
  LogInIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";

import { orpc } from "~/orpc/react";
import { ConfirmButton } from "./confirm-button";
import { ErrorState } from "./states";
import { formatDateTime, formatTime } from "./time";

/** ~2 minutes of checks, then the webhook (and a page reload) take over. */
const MAX_CHECKS = 48;

/**
 * A visitor's booking, opened by the secret in their link — no account
 * needed. This is where the payment form sends them back: the page checks the
 * payment until it settles, then shows the booking, lets them cancel it (24 h
 * rule) and leads to the cabinet, which opens with a code sent by email.
 */
export function GuestBooking({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const options = orpc.booking.guest.queryOptions({ input: { token } });
  const booking = useQuery({
    ...options,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.state === "awaiting_payment" &&
      query.state.dataUpdateCount < MAX_CHECKS
        ? 2500
        : false,
  });

  const cancel = useMutation({
    ...orpc.booking.cancelGuest.mutationOptions(),
    onSuccess: async () => {
      toast.success("Запись отменена, занятие осталось на вашем балансе");
      await queryClient.invalidateQueries({ queryKey: options.queryKey });
    },
    onError: (error) => toast.error(error.message),
  });

  const data = booking.data;
  const terms = professionTerms(data?.practice.profession ?? "other");

  return (
    <main className="flex min-h-svh items-start justify-center bg-muted/40 px-4 py-8 md:items-center md:py-12 dark:bg-background">
      <Card className="w-full max-w-lg gap-5 p-6">
        {booking.isError ? (
          <ErrorState
            message="Ссылка недействительна или запись удалена."
            onRetry={() => booking.refetch()}
          />
        ) : !data ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="size-12 rounded-xl" />
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : (
          <>
            {data.state === "awaiting_payment" && (
              <Status
                icon={<Spinner className="size-5" />}
                title="Ждём подтверждения оплаты"
                text={
                  data.holdUntil
                    ? `Время держится за вами до ${formatTime(data.holdUntil)}.`
                    : undefined
                }
              />
            )}
            {data.state === "confirmed" && (
              <Status
                icon={<CircleCheckIcon className="text-success" />}
                title="Вы записаны"
              />
            )}
            {data.state === "expired" && (
              <Status
                icon={<Clock3Icon />}
                title="Время не удалось удержать"
                text="Оплата не прошла в срок, и время снова открыто для записи. Если деньги всё же списались, они вернутся на карту."
              />
            )}
            {data.state === "cancelled" && (
              <Status
                icon={<CalendarXIcon />}
                title="Запись отменена"
                text={`Оплаченное занятие осталось на вашем балансе: ${formatCredits(data.balance, terms)}.`}
              />
            )}

            <dl className="flex flex-col gap-2 rounded-md border p-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Специалист</dt>
                <dd className="text-right font-medium">{data.practice.name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Когда</dt>
                <dd className="text-right font-medium first-letter:uppercase">
                  {formatDateTime(data.startsAt)}–{formatTime(data.endsAt)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">На имя</dt>
                <dd className="text-right font-medium">{data.name}</dd>
              </div>
            </dl>

            {data.state === "confirmed" && data.balance > 0 && (
              <Alert variant="info">
                <WalletIcon />
                <AlertTitle>
                  На балансе ещё {formatCredits(data.balance, terms)}
                </AlertTitle>
                <AlertDescription>
                  Записывайтесь на следующие встречи в личном кабинете.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              {data.state === "awaiting_payment" && data.payUrl && (
                <Button
                  nativeButton={false}
                  render={
                    // biome-ignore lint/a11y/useAnchorContent: Button renders the children.
                    <a href={data.payUrl} />
                  }
                >
                  Перейти к оплате
                </Button>
              )}
              {(data.state === "expired" || data.state === "cancelled") && (
                <Button
                  nativeButton={false}
                  render={
                    <Link href={paths.booking.public(data.practice.slug)} />
                  }
                >
                  <CalendarPlusIcon />
                  {data.state === "expired"
                    ? "Выбрать другое время"
                    : "Записаться снова"}
                </Button>
              )}
              {data.state === "confirmed" && data.canCancel && (
                <ConfirmButton
                  title="Отменить запись?"
                  description={`${formatCredits(1, terms)} вернётся на ваш баланс — им можно оплатить другое время.`}
                  confirmLabel="Отменить запись"
                  disabled={cancel.isPending}
                  onConfirm={() => cancel.mutate({ token })}
                >
                  Отменить запись
                </ConfirmButton>
              )}
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href={paths.booking.mine} />}
              >
                <LogInIcon />
                Личный кабинет
              </Button>
            </div>

            {data.state === "confirmed" && !data.canCancel && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <CalendarClockIcon className="size-3.5 shrink-0" />
                Отменить самостоятельно можно не позднее чем за 24 часа до
                начала — позже свяжитесь со специалистом.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              В кабинет вы войдёте по коду, который придёт на {data.email}.
              Сохраните эту страницу — по ссылке запись открывается без входа.
            </p>
          </>
        )}
      </Card>
    </main>
  );
}

function Status({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <IconTile variant="soft" size="lg" aria-hidden="true">
        {icon}
      </IconTile>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {text && <p className="text-sm text-muted-foreground">{text}</p>}
      </div>
    </div>
  );
}
