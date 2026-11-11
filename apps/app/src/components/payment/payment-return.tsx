"use client";

import { paths } from "@synoro/config";
import { Button, Spinner } from "@synoro/ui";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import { formatCredits, professionTerms } from "@synoro/validators";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarPlusIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { orpc } from "~/orpc/react";

/** ~2 minutes of checks, then the webhook takes it from there. */
const MAX_CHECKS = 48;

/**
 * Back from the payment page (`?payment=<id>`): checks the payment until
 * the provider settles it and says what happened. On success the balances
 * on the page refresh themselves.
 */
export function PaymentReturn({
  onRetry,
}: {
  onRetry: (practiceId: string) => void;
}) {
  const paymentId = useSearchParams().get("payment");
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const options = orpc.payment.status.queryOptions({
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
    for (const key of [
      orpc.practice.key(),
      orpc.credit.key(),
      orpc.payment.mine.key(),
    ]) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }, [status, queryClient]);

  if (!paymentId || payment.isError) return null;

  const dismiss = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Скрыть"
      className="absolute top-2 right-2"
      onClick={() => router.replace(pathname as typeof paths.booking.mine)}
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
            ? "Баланс пополнится автоматически, как только платёжная система подтвердит оплату."
            : "Обычно это занимает несколько секунд."}
        </AlertDescription>
        {slow && dismiss}
      </Alert>
    );
  }

  const { data } = payment;
  const terms = professionTerms(data.profession);
  if (data.status === "succeeded") {
    return (
      <Alert variant="success" className="relative pr-12">
        <CircleCheckIcon />
        <AlertTitle>
          Оплата прошла: +{formatCredits(data.credits, terms)}
        </AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          <span>
            {data.practiceName}
            {data.balance !== null &&
              ` · на балансе ${formatCredits(data.balance, terms)}`}
          </span>
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href={paths.booking.public(data.practiceSlug)} />}
          >
            <CalendarPlusIcon />
            Выбрать время
          </Button>
        </AlertDescription>
        {dismiss}
      </Alert>
    );
  }

  return (
    <Alert variant="destructive" className="relative pr-12">
      <CircleAlertIcon />
      <AlertTitle>Оплата не прошла</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>Деньги не списаны. Попробуйте ещё раз или другой картой.</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onRetry(data.practiceId)}
        >
          Попробовать снова
        </Button>
      </AlertDescription>
      {dismiss}
    </Alert>
  );
}
