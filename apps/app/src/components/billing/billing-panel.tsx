"use client";

import { isDefinedError } from "@orpc/client";
import type { RouterOutputs } from "@synoro/api";
import type { paths } from "@synoro/config";
import { Button, Skeleton, Spinner, toast } from "@synoro/ui";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import { Badge } from "@synoro/ui/reui/badge";
import { type BillingPeriodId, TRIAL_DAYS } from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  XIcon,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { orpc } from "~/orpc/react";
import { ErrorState } from "../booking/states";
import { formatRub } from "../payment/format";

type Billing = RouterOutputs["billing"]["get"];
type Plan = Billing["plan"];

const PRO_FEATURES = [
  "Оплата пакетов онлайн через ЮKassa или Т-Банк",
  "Пакет начисляется клиенту сразу после оплаты",
  "Свой домен для страницы записи",
  "Администратор в команде",
];

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const formatDate = (at: Date) => dateFormat.format(at);

/** ~2 minutes of checks, then the webhook takes it from there. */
const MAX_CHECKS = 48;

function PlanStatus({ plan }: { plan: Plan }) {
  if (plan.status === "active" && plan.activeUntil) {
    return (
      <>
        <Badge variant="success-light">Оплачен</Badge>
        <p className="text-sm text-muted-foreground">
          «Про» работает до {formatDate(plan.activeUntil)}. Продлить можно в
          любой момент — новый период начнётся, когда закончится текущий.
        </p>
      </>
    );
  }
  if (plan.status === "trial" && plan.trialEndsAt) {
    return (
      <>
        <Badge variant="info-light">Пробный период</Badge>
        <p className="text-sm text-muted-foreground">
          Все возможности «Про» бесплатно до {formatDate(plan.trialEndsAt)}.
          Оплатите заранее — оплаченный период начнётся после пробного.
        </p>
      </>
    );
  }
  if (plan.status === "expired") {
    return (
      <>
        <Badge variant="warning-light">Бесплатный тариф</Badge>
        <p className="text-sm text-muted-foreground">
          Срок «Про» закончился
          {plan.activeUntil && ` ${formatDate(plan.activeUntil)}`}. Записи,
          клиенты и расписание работают как прежде; онлайн-оплата, свой домен и
          администраторы включатся снова после оплаты.
        </p>
      </>
    );
  }
  return (
    <>
      <Badge variant="secondary">Бесплатный тариф</Badge>
      <p className="text-sm text-muted-foreground">
        Создайте практику — {TRIAL_DAYS} дней «Про» бесплатно, без карты.
      </p>
    </>
  );
}

function PeriodOption({
  period,
  billing,
  pending,
  onPay,
}: {
  period: BillingPeriodId;
  billing: Billing;
  pending: BillingPeriodId | null;
  onPay: (period: BillingPeriodId) => void;
}) {
  const price = billing.prices[period];
  const monthly = billing.prices.month.amount;
  const saving = monthly * price.months - price.amount;
  const renew = billing.plan.status === "active";

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{price.label}</span>
        {saving > 0 && (
          <Badge variant="success-light">−{formatRub(saving)}</Badge>
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular-nums">
          {formatRub(price.amount)}
        </span>
        <span className="text-sm text-muted-foreground">
          {period === "year" ? "за год" : "в месяц"}
        </span>
      </div>
      <span className="text-xs text-muted-foreground">
        {period === "year"
          ? `${formatRub(Math.round(price.amount / 12))} в месяц, два месяца в подарок`
          : "Без автосписаний: продлеваете, когда удобно"}
      </span>
      <Button
        className="mt-auto"
        variant={period === "year" ? "default" : "outline"}
        disabled={!billing.available || pending !== null}
        onClick={() => onPay(period)}
      >
        {pending === period && <Spinner />}
        {renew ? "Продлить" : "Оплатить"} {period === "year" ? "год" : "месяц"}
      </Button>
    </div>
  );
}

/**
 * Back from the Точка payment page (`?payment=<id>`): checks the payment
 * until the bank settles it and says what happened.
 */
function PaymentReturn() {
  const paymentId = useSearchParams().get("payment");
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const options = orpc.billing.status.queryOptions({
    input: { paymentId: paymentId ?? "" },
  });
  const payment = useQuery({
    ...options,
    enabled: !!paymentId,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === "pending" &&
      query.state.dataUpdateCount < MAX_CHECKS
        ? 2500
        : false,
  });

  const status = payment.data?.status;
  useEffect(() => {
    if (status !== "succeeded") return;
    void queryClient.invalidateQueries({ queryKey: orpc.billing.key() });
  }, [status, queryClient]);

  if (!paymentId || payment.isError) return null;

  const dismiss = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Скрыть"
      className="absolute top-2 right-2"
      onClick={() => router.replace(pathname as typeof paths.settings.billing)}
    >
      <XIcon />
    </Button>
  );

  if (!payment.data || payment.data.status === "pending") {
    const checks =
      queryClient.getQueryState(options.queryKey)?.dataUpdateCount ?? 0;
    const slow = checks >= MAX_CHECKS;
    return (
      <Alert variant="info" className="relative pr-12">
        <Spinner />
        <AlertTitle>
          {slow ? "Платёж ещё обрабатывается" : "Проверяем оплату…"}
        </AlertTitle>
        <AlertDescription>
          {slow
            ? "Тариф продлится автоматически, как только банк подтвердит оплату."
            : "Обычно это занимает несколько секунд."}
        </AlertDescription>
        {slow && dismiss}
      </Alert>
    );
  }

  if (payment.data.status === "succeeded") {
    const until = payment.data.plan.activeUntil;
    return (
      <Alert variant="success" className="relative pr-12">
        <CircleCheckIcon />
        <AlertTitle>Оплата прошла, спасибо!</AlertTitle>
        <AlertDescription>
          {until
            ? `«Про» работает до ${formatDate(until)}. Чек придёт на почту.`
            : "Чек придёт на почту."}
        </AlertDescription>
        {dismiss}
      </Alert>
    );
  }

  return (
    <Alert variant="destructive" className="relative pr-12">
      <CircleAlertIcon />
      <AlertTitle>Оплата не прошла</AlertTitle>
      <AlertDescription>
        Деньги не списаны. Попробуйте ещё раз, другой картой или через СБП.
      </AlertDescription>
      {dismiss}
    </Alert>
  );
}

/**
 * The «Про» plan: what it gives, the trial or paid period, and paying for a
 * month or a year through Точка Банк (card or СБП).
 */
export function BillingPanel() {
  const billing = useQuery(orpc.billing.get.queryOptions());
  const checkout = useMutation({
    ...orpc.billing.checkout.mutationOptions(),
    // Keep the button busy until the browser leaves for the payment page.
    onSuccess: ({ confirmationUrl }) => window.location.assign(confirmationUrl),
    onError: (error) =>
      toast.error(
        isDefinedError(error) ? error.message : "Не удалось начать оплату",
      ),
  });
  const pending =
    checkout.isPending || checkout.isSuccess
      ? (checkout.variables?.period ?? null)
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Тариф «Про»</h2>
        <p className="text-sm text-muted-foreground">
          Для тех, кто принимает оплату онлайн и работает с помощником.
        </p>
      </div>

      <PaymentReturn />

      {billing.isError ? (
        <ErrorState onRetry={() => billing.refetch()} />
      ) : billing.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-16 w-full rounded-md" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-44 rounded-lg" />
            <Skeleton className="h-44 rounded-lg" />
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col items-start gap-2">
            <PlanStatus plan={billing.data.plan} />
          </div>

          <ul className="flex flex-col gap-2 text-sm">
            {PRO_FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-2">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                {feature}
              </li>
            ))}
          </ul>

          {!billing.data.available && (
            <Alert variant="warning">
              <AlertTitle>Оплата тарифа временно недоступна</AlertTitle>
              <AlertDescription>
                Мы подключаем приём платежей. Пробный период и оплаченные дни
                продолжают работать.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {(["month", "year"] as const).map((period) => (
              <PeriodOption
                key={period}
                period={period}
                billing={billing.data}
                pending={pending}
                onPay={(value) => checkout.mutate({ period: value })}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Оплата картой или через СБП на странице Точка Банка. Чек придёт на
            почту. Автоматических списаний нет.
          </p>

          {billing.data.payments.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">История оплат</h3>
              <ul className="flex flex-col divide-y rounded-lg border text-sm">
                {billing.data.payments.map((payment) => (
                  <li
                    key={payment.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  >
                    <span>
                      {payment.paidAt && formatDate(payment.paidAt)} ·{" "}
                      {payment.period === "year" ? "год" : "месяц"}
                      {payment.periodEnd &&
                        ` · до ${formatDate(payment.periodEnd)}`}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatRub(payment.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
