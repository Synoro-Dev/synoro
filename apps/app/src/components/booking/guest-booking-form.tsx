"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { isDefinedError } from "@orpc/client";
import {
  Button,
  FieldLabel,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Spinner,
  Textarea,
  toast,
} from "@synoro/ui";
import { Badge } from "@synoro/ui/reui/badge";
import {
  formatCredits,
  type GuestBookingFormInput,
  type GuestBookingFormValues,
  guestBookingFormSchema,
  type Profession,
  professionTerms,
} from "@synoro/validators";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeftIcon, LockIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { BookingLegalNotice } from "~/components/legal-links";
import { leaveFrame } from "~/lib/leave-frame";
import { orpc } from "~/orpc/react";
import { formatRub, packageDeals } from "../payment/format";
import { formatDateTime } from "./time";

interface Offer {
  provider: string | null;
  test: boolean;
  packages: { id: string; credits: number; price: number }[];
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}

/**
 * The visitor's side of booking without an account: who they are (name,
 * phone and email are required), which package to pay for, and off to the
 * provider's payment page. The time is held for 15 minutes meanwhile; the
 * visitor comes back to `/b/<token>`, where the payment is checked.
 */
export function GuestBookingForm({
  practice,
  startsAt,
  offer,
  onBack,
}: {
  practice: { id: string; name: string; profession: Profession };
  startsAt: Date;
  offer: Offer;
  onBack: () => void;
}) {
  const terms = professionTerms(practice.profession);
  const deals = packageDeals(offer.packages);
  const [packageId, setPackageId] = useState(deals[0]?.id ?? "");
  const selected = deals.find((d) => d.id === packageId) ?? deals[0];

  const form = useForm<GuestBookingFormInput, unknown, GuestBookingFormValues>({
    resolver: zodResolver(guestBookingFormSchema),
    defaultValues: { name: "", phone: "", email: "", note: "" },
  });
  const { errors } = form.formState;

  const reserve = useMutation({
    ...orpc.booking.reserve.mutationOptions(),
    // Keep the button busy until the browser leaves for the payment page.
    // The booking page may sit in an iframe; the payment page can't.
    onSuccess: ({ confirmationUrl }) => leaveFrame(confirmationUrl),
    onError: (error) =>
      toast.error(
        isDefinedError(error) ? error.message : "Не удалось начать оплату",
      ),
  });
  const leaving = reserve.isPending || reserve.isSuccess;

  function submit(values: GuestBookingFormValues) {
    if (!selected) return;
    reserve.mutate({
      ...values,
      note: values.note || undefined,
      practiceId: practice.id,
      packageId: selected.id,
      startsAt,
    });
  }

  return (
    <form
      onSubmit={form.handleSubmit(submit)}
      className="flex flex-col gap-4"
      noValidate
    >
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="-ml-2 self-start"
          onClick={onBack}
        >
          <ArrowLeftIcon />
          Другое время
        </Button>
        <p className="text-sm font-semibold first-letter:uppercase">
          {formatDateTime(startsAt)}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="guest-name">Имя</Label>
        <Input
          id="guest-name"
          autoComplete="name"
          placeholder="Иван Петров"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "guest-name-error" : undefined}
          {...form.register("name")}
        />
        <FieldError id="guest-name-error" message={errors.name?.message} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="guest-phone">Телефон</Label>
        <Input
          id="guest-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+7 900 123-45-67"
          aria-invalid={!!errors.phone}
          aria-describedby={errors.phone ? "guest-phone-error" : undefined}
          {...form.register("phone")}
        />
        <FieldError id="guest-phone-error" message={errors.phone?.message} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="guest-email">Электронная почта</Label>
        <Input
          id="guest-email"
          type="email"
          autoComplete="email"
          placeholder="ivan@example.com"
          aria-invalid={!!errors.email}
          aria-describedby={
            errors.email ? "guest-email-error" : "guest-email-hint"
          }
          {...form.register("email")}
        />
        <FieldError id="guest-email-error" message={errors.email?.message} />
        {!errors.email && (
          <p id="guest-email-hint" className="text-xs text-muted-foreground">
            По ней вы откроете личный кабинет: записи, баланс, оплаты.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="guest-note">Комментарий</Label>
        <Textarea
          id="guest-note"
          rows={2}
          placeholder="Необязательно"
          {...form.register("note")}
        />
      </div>

      <RadioGroup
        value={selected?.id ?? ""}
        onValueChange={(value) => setPackageId(String(value))}
        aria-label="Что оплатить"
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
                  Первая — на выбранное время, остальные на вашем балансе
                </span>
              )}
            </span>
            <span className="font-semibold tabular-nums">
              {formatRub(deal.price)}
            </span>
          </FieldLabel>
        ))}
      </RadioGroup>

      <Button type="submit" size="lg" disabled={leaving || !selected}>
        {leaving && <Spinner />}
        {selected ? `Оплатить ${formatRub(selected.price)}` : "Оплатить"}
      </Button>
      {reserve.data && (
        <a
          href={reserve.data.confirmationUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary underline underline-offset-4"
        >
          Если оплата не открылась, откройте её в новой вкладке
        </a>
      )}
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <LockIcon className="mt-0.5 size-3 shrink-0" />
        <span>
          Вход не нужен. Время держится за вами 15 минут, пока вы платите картой
          или через СБП на странице {offer.provider}. Деньги поступают
          специалисту напрямую.
          {offer.test && " Тестовый режим: деньги не списываются."}
        </span>
      </p>
      <BookingLegalNotice />
    </form>
  );
}
