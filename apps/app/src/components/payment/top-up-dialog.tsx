"use client";

import { isDefinedError } from "@orpc/client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldLabel,
  RadioGroup,
  RadioGroupItem,
  Skeleton,
  Spinner,
  toast,
} from "@synoro/ui";
import { Badge } from "@synoro/ui/reui/badge";
import {
  formatCredits,
  type Profession,
  professionTerms,
} from "@synoro/validators";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LockIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { ErrorState } from "../booking/states";
import { formatRub, packageDeals } from "./format";

type TopUpPractice = { id: string; name: string; profession: Profession };

/**
 * Buy a package of credits: pick one, go to the provider's payment
 * page, come back to the cabinet where the payment is checked.
 */
export function TopUpDialog({
  practice,
  balance,
  open,
  onOpenChange,
}: {
  practice: TopUpPractice;
  balance: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <TopUpForm practice={practice} balance={balance} />}
      </DialogContent>
    </Dialog>
  );
}

function TopUpForm({
  practice,
  balance,
}: {
  practice: TopUpPractice;
  balance: number;
}) {
  const terms = professionTerms(practice.profession);
  const offer = useQuery(
    orpc.payment.packages.queryOptions({ input: { practiceId: practice.id } }),
  );
  const [picked, setPicked] = useState<string | null>(null);

  const checkout = useMutation({
    ...orpc.payment.checkout.mutationOptions(),
    // Keep the button busy until the browser leaves for the payment page.
    onSuccess: ({ confirmationUrl }) => window.location.assign(confirmationUrl),
    onError: (error) =>
      toast.error(
        isDefinedError(error) ? error.message : "Не удалось начать оплату",
      ),
  });

  const deals = packageDeals(offer.data?.packages ?? []);
  const selected = deals.find((d) => d.id === picked) ?? deals[0];
  const leaving = checkout.isPending || checkout.isSuccess;

  return (
    <div className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Пополнить баланс</DialogTitle>
        <DialogDescription>
          {practice.name} · сейчас оплачено: {formatCredits(balance, terms)}
        </DialogDescription>
      </DialogHeader>

      {offer.isError ? (
        <ErrorState onRetry={() => offer.refetch()} />
      ) : offer.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full rounded-md" />
          <Skeleton className="h-16 w-full rounded-md" />
        </div>
      ) : !offer.data.enabled ? (
        <p className="text-sm text-muted-foreground">
          Специалист пока не принимает оплату онлайн. Оплатите {terms.credits}{" "}
          напрямую — администратор добавит их на баланс.
        </p>
      ) : (
        <RadioGroup
          value={selected?.id ?? ""}
          onValueChange={(value) => setPicked(String(value))}
          aria-label={`Пакет: ${terms.credit[2]}`}
          className="gap-2"
        >
          {deals.map((deal) => (
            <FieldLabel
              key={deal.id}
              className="flex w-full cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50 has-data-checked:border-primary has-data-checked:bg-primary/5 dark:has-data-checked:bg-primary/10"
            >
              <RadioGroupItem value={deal.id} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2 font-medium">
                  {formatCredits(deal.credits, terms)}
                  {deal.discount > 0 && (
                    <Badge variant="success-light">−{deal.discount}%</Badge>
                  )}
                </span>
                {deal.credits > 1 && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {formatRub(deal.unitPrice)} за {terms.creditAccusative}
                  </span>
                )}
              </span>
              <span className="font-semibold tabular-nums">
                {formatRub(deal.price)}
              </span>
            </FieldLabel>
          ))}
        </RadioGroup>
      )}

      {offer.data?.enabled && selected && (
        <>
          <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">После оплаты</span>
            <span className="font-medium">
              {formatCredits(balance + selected.credits, terms)}
            </span>
          </div>
          <DialogFooter className="flex-col gap-3 sm:flex-col">
            <Button
              size="lg"
              className="w-full"
              disabled={leaving}
              onClick={() =>
                checkout.mutate({
                  practiceId: practice.id,
                  packageId: selected.id,
                })
              }
            >
              {leaving && <Spinner />}
              Оплатить {formatRub(selected.price)}
            </Button>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <LockIcon className="mt-0.5 size-3 shrink-0" />
              <span>
                Картой или через СБП на защищённой странице{" "}
                {offer.data.provider}. Деньги поступают специалисту напрямую.
                {offer.data.test && " Тестовый режим: деньги не списываются."}
              </span>
            </p>
          </DialogFooter>
        </>
      )}
    </div>
  );
}
