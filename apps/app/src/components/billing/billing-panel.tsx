"use client";

import { isDefinedError } from "@orpc/client";
import type { RouterOutputs } from "@synoro/api";
import type { paths } from "@synoro/config";
import {
  Button,
  Checkbox,
  cn,
  Label,
  Skeleton,
  Spinner,
  toast,
} from "@synoro/ui";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import { Badge, type BadgeProps } from "@synoro/ui/reui/badge";
import {
  type BillingPeriodId,
  PRO_PRICES,
  TRIAL_DAYS,
} from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  FlaskConicalIcon,
  XIcon,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { orpc } from "~/orpc/react";
import { ErrorState } from "../booking/states";
import { LegalLink } from "../legal-links";
import { formatRub } from "../payment/format";
import {
  daysLeft,
  ENDING_SOON_DAYS,
  FREE_FEATURES,
  formatDate,
  formatDays,
  PRO_FEATURES,
  planName,
} from "./plan";
import { TrialDays } from "./trial-days";
import { usePlanClock } from "./use-plan-clock";

type Billing = RouterOutputs["billing"]["get"];

/** ~2 minutes of checks, then the webhook takes it from there. */
const MAX_CHECKS = 48;

/** What the user is on right now, how long it lasts and what happens next. */
function CurrentPlan({ billing }: { billing: Billing }) {
  const { plan, autorenew } = billing;
  const until = !plan.pro
    ? null
    : plan.status === "trial"
      ? plan.trialEndsAt
      : plan.activeUntil;
  usePlanClock(until);
  const left = until ? daysLeft(until) : 0;
  const endingSoon = plan.pro && !autorenew && left <= ENDING_SOON_DAYS;

  let badge: { label: string; variant: BadgeProps["variant"] } | null = null;
  let note: string;
  if (plan.status === "trial" && plan.trialEndsAt) {
    badge = {
      label: `Осталось ${formatDays(left)}`,
      variant: endingSoon ? "warning-light" : "info-light",
    };
    note = `Все возможности «Про» бесплатно до ${formatDate(plan.trialEndsAt)}. Потом включится бесплатный тариф: записи и клиенты останутся, а онлайн-оплата, свой домен и анкета выключатся. Оплатите сейчас — оплаченный период начнётся после пробного.`;
  } else if (plan.status === "active" && plan.activeUntil) {
    badge = endingSoon
      ? { label: `Осталось ${formatDays(left)}`, variant: "warning-light" }
      : { label: "Оплачен", variant: "success-light" };
    note = `${autorenew ? "Продлится автоматически" : "Оплачен до"} ${formatDate(plan.activeUntil)}. Продлить можно в любой момент — новый период начнётся, когда закончится текущий.`;
  } else if (plan.status === "expired") {
    badge = plan.activeUntil
      ? {
          label: `«Про» закончился ${formatDate(plan.activeUntil)}`,
          variant: "warning-light",
        }
      : null;
    note =
      "Записи, клиенты и расписание работают как прежде. Онлайн-оплата, свой домен, анкета и администраторы включатся снова сразу после оплаты.";
  } else {
    note = `Создайте практику — ${TRIAL_DAYS} дней «Про» бесплатно, без карты.`;
  }

  return (
    <section
      aria-labelledby="current-plan"
      className={cn(
        "flex flex-col gap-4 rounded-xl border p-5",
        plan.pro ? "border-info/30" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Сейчас у вас</span>
          <h3
            id="current-plan"
            className="text-2xl leading-none font-semibold tracking-tight"
          >
            {planName(plan)}
          </h3>
        </div>
        {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
      </div>
      {plan.status === "trial" && (
        <TrialDays
          left={left}
          endingSoon={endingSoon}
          className="[&>span]:h-2"
        />
      )}
      <p className="max-w-prose text-sm text-muted-foreground">{note}</p>
    </section>
  );
}

/** Free and «Про» side by side, the user's own plan marked. */
function PlanComparison({ plan }: { plan: Billing["plan"] }) {
  const columns = [
    {
      id: "free",
      name: "Бесплатный",
      price: "0 ₽ навсегда",
      lead: null,
      features: FREE_FEATURES,
      current: !plan.pro,
    },
    {
      id: "pro",
      name: "«Про»",
      price: `${formatRub(PRO_PRICES.month.amount)} в месяц или ${formatRub(PRO_PRICES.year.amount)} за год`,
      lead: "Всё из бесплатного, и ещё:",
      features: PRO_FEATURES,
      current: plan.pro,
    },
  ];

  return (
    <section aria-labelledby="plan-comparison" className="flex flex-col gap-3">
      <h3 id="plan-comparison" className="text-sm font-medium">
        Что входит в тарифы
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {columns.map((column) => (
          <div
            key={column.id}
            className={cn(
              "flex flex-col gap-3 rounded-lg border p-4",
              column.current && "border-primary ring-1 ring-primary",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{column.name}</span>
                <span className="text-xs text-muted-foreground">
                  {column.price}
                </span>
              </div>
              {column.current && (
                <Badge variant="primary-light">
                  {plan.status === "trial" ? "Пробный период" : "Ваш тариф"}
                </Badge>
              )}
            </div>
            {column.lead && (
              <span className="text-sm text-muted-foreground">
                {column.lead}
              </span>
            )}
            <ul className="flex flex-col gap-2 text-sm">
              {column.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <CheckIcon
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      column.id === "pro"
                        ? "text-info"
                        : "text-muted-foreground",
                    )}
                  />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
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
          : "Продлеваете, когда удобно, или включаете автопродление"}
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

  // Точка's sandbox links can't be paid: play the bank here instead.
  const sandboxPay = useMutation({
    ...orpc.billing.sandboxPay.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orpc.billing.key() }),
    onError: () => toast.error("Не удалось подтвердить тестовый платёж"),
  });

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

  if (payment.data?.status === "pending" && payment.data.sandbox) {
    return (
      <Alert variant="warning">
        <FlaskConicalIcon />
        <AlertTitle>Тестовая оплата</AlertTitle>
        <AlertDescription>
          <p>
            Песочница Точки не принимает платежи, деньги не списываются.
            Подтвердите оплату сами — «Про» продлится так же, как после
            настоящей.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={sandboxPay.isPending}
              onClick={() =>
                sandboxPay.mutate({ paymentId, outcome: "succeeded" })
              }
            >
              {sandboxPay.isPending && <Spinner />}
              Оплатить
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={sandboxPay.isPending}
              onClick={() =>
                sandboxPay.mutate({ paymentId, outcome: "canceled" })
              }
            >
              Отказаться
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

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

/** Auto-renewal is on: when the card is charged next, and the way to stop it. */
function AutorenewOn({
  autorenew,
  plan,
}: {
  autorenew: NonNullable<Billing["autorenew"]>;
  plan: Billing["plan"];
}) {
  const queryClient = useQueryClient();
  const cancel = useMutation({
    ...orpc.billing.cancelAutorenew.mutationOptions(),
    onSuccess: () => {
      toast.success("Автопродление отключено");
      return queryClient.invalidateQueries({ queryKey: orpc.billing.key() });
    },
    onError: () => toast.error("Не удалось отключить автопродление"),
  });

  return (
    <Alert variant="info">
      <CircleCheckIcon />
      <AlertTitle>Автопродление включено</AlertTitle>
      <AlertDescription>
        <p>
          {plan.paidUntil
            ? `За сутки до ${formatDate(plan.paidUntil)} `
            : "Перед окончанием оплаченного срока "}
          с карты спишется {formatRub(autorenew.amount)} за{" "}
          {autorenew.period === "year" ? "год" : "месяц"}. Уже оплаченный период
          сохранится, если отключить.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          {cancel.isPending && <Spinner />}
          Отключить автопродление
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/**
 * The «Про» plan: what it gives, the trial or paid period, and paying for a
 * month or a year through Точка Банк (card or СБП).
 */
export function BillingPanel() {
  const billing = useQuery(orpc.billing.get.queryOptions());
  const [autorenew, setAutorenew] = useState(false);
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
        <h2 className="text-lg font-semibold tracking-tight">Тариф</h2>
        <p className="text-sm text-muted-foreground">
          Бесплатный тариф — навсегда. «Про» — когда клиенты платят онлайн и с
          вами работает помощник.
        </p>
      </div>

      <PaymentReturn />

      {billing.isError ? (
        <ErrorState onRetry={() => billing.refetch()} />
      ) : billing.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-36 w-full rounded-xl" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-44 rounded-lg" />
            <Skeleton className="h-44 rounded-lg" />
          </div>
        </div>
      ) : (
        <>
          <CurrentPlan billing={billing.data} />

          {billing.data.sandbox && (
            <Alert variant="info">
              <FlaskConicalIcon />
              <AlertTitle>Тестовый режим</AlertTitle>
              <AlertDescription>
                Запросы уходят в песочницу Точки, деньги не списываются. Оплату
                подтверждаете вы сами на этой странице.
              </AlertDescription>
            </Alert>
          )}

          {!billing.data.available && (
            <Alert variant="warning">
              <AlertTitle>Оплата тарифа временно недоступна</AlertTitle>
              <AlertDescription>
                Мы подключаем приём платежей. Пробный период и оплаченные дни
                продолжают работать.
              </AlertDescription>
            </Alert>
          )}

          <h3 className="-mb-2 text-sm font-medium">
            {billing.data.plan.status === "active"
              ? "Продлить «Про»"
              : billing.data.plan.status === "expired"
                ? "Вернуть «Про»"
                : "Перейти на «Про»"}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["month", "year"] as const).map((period) => (
              <PeriodOption
                key={period}
                period={period}
                billing={billing.data}
                pending={pending}
                onPay={(value) =>
                  checkout.mutate({
                    period: value,
                    autorenew: autorenew && !billing.data.autorenew,
                  })
                }
              />
            ))}
          </div>
          {billing.data.autorenew ? (
            <AutorenewOn
              autorenew={billing.data.autorenew}
              plan={billing.data.plan}
            />
          ) : (
            <div className="flex items-start gap-2">
              <Checkbox
                id="autorenew"
                checked={autorenew}
                onCheckedChange={(checked) => setAutorenew(checked === true)}
                className="mt-0.5"
              />
              {/* TODO(legal): final wording of the consent and the section of
                  the Terms on automatic charges are written by a lawyer. */}
              <Label
                htmlFor="autorenew"
                className="text-xs leading-snug font-normal text-muted-foreground"
              >
                Продлевать «Про» автоматически: согласен, что с моей карты будут
                списываться деньги за следующий период, пока я не отключу
                автопродление. Условия — в{" "}
                <LegalLink doc="terms">пользовательском соглашении</LegalLink>.
                Только оплата картой.
              </Label>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Оплата картой или через СБП на странице Точка Банка (с
            автопродлением — только картой). Чек придёт на почту.
          </p>

          <PlanComparison plan={billing.data.plan} />

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
                    <span className="flex items-center gap-2">
                      {payment.refundedAt && (
                        <span className="text-xs text-muted-foreground">
                          возвращён {formatDate(payment.refundedAt)}
                        </span>
                      )}
                      <span
                        className={cn(
                          "font-medium tabular-nums",
                          payment.refundedAt &&
                            "text-muted-foreground line-through",
                        )}
                      >
                        {formatRub(payment.amount)}
                      </span>
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
