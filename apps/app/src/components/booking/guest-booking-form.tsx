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
  type BookingQuestion,
  checkBookingAnswers,
  formatCredits,
  type GuestBookingFormInput,
  type GuestBookingFormValues,
  guestBookingFormSchema,
  type Profession,
  professionTerms,
} from "@synoro/validators";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LockIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { BookingLegalNotice } from "~/components/legal-links";
import { leaveFrame } from "~/lib/leave-frame";
import { orpc } from "~/orpc/react";
import { formatRub, packageDeals } from "../payment/format";
import { BookingQuestionFields } from "./booking-question-fields";
import {
  type ConsentDocument,
  ConsentFields,
  useConsents,
} from "./consent-fields";
import {
  type Repeat,
  RepeatSelect,
  SeriesDateList,
  seriesChoice,
  useGuestSeriesPreview,
} from "./series-fields";

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
 * visitor comes back to `/b/<token>`, where the payment is checked. The
 * chosen time itself is shown beside the form (`BookingTicket`).
 */
export function GuestBookingForm({
  practice,
  startsAt,
  timeZone,
  offer,
  service,
  questions,
  documents,
  acceptsMinors,
}: {
  practice: { id: string; name: string; profession: Profession };
  /** What is being booked; the practice's first service when missing. */
  service?: { id?: string; credits: number };
  startsAt: Date;
  /** The zone the visitor reads times in; their mails use it too. */
  timeZone: string;
  offer: Offer;
  /** The practice's questionnaire («Про»); empty when none is asked. */
  questions: BookingQuestion[];
  /** The practice's documents to accept; empty when it has none. */
  documents: ConsentDocument[];
  acceptsMinors: boolean;
}) {
  const queryClient = useQueryClient();
  const terms = professionTerms(practice.profession);
  const price = service?.credits ?? 1;
  const allDeals = packageDeals(offer.packages);
  // How many times the biggest package pays for: the limit of a repeat.
  const affordable = Math.floor(
    Math.max(0, ...allDeals.map((d) => d.credits)) / price,
  );
  const [repeat, setRepeat] = useState<Repeat | null>(null);
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());
  const preview = useGuestSeriesPreview({
    practiceId: practice.id,
    startsAt,
    repeat,
    serviceId: service?.id,
  });
  const { chosen, skip } = seriesChoice(preview.data?.dates ?? [], unchecked);
  // How many times is booked: the chosen dates of a repeat, else one.
  const times = repeat ? chosen.length : 1;
  const needed = times * price;
  // A package must cover every time: the payment spends the price on each.
  const deals = allDeals.filter((d) => d.credits >= needed);
  const [packageId, setPackageId] = useState(deals[0]?.id ?? "");
  const selected = deals.find((d) => d.id === packageId) ?? deals[0];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const consents = useConsents(documents, acceptsMinors);

  const form = useForm<GuestBookingFormInput, unknown, GuestBookingFormValues>({
    resolver: zodResolver(guestBookingFormSchema),
    defaultValues: { name: "", phone: "", email: "", note: "" },
  });
  const { errors } = form.formState;

  // The practice's questions and documents may have changed meanwhile: fetch
  // what is in force now (they come from `practice.bySlug`).
  const refreshPractice = () =>
    queryClient.invalidateQueries({ queryKey: orpc.practice.key() });

  // Keep the button busy until the browser leaves for the payment page.
  // The booking page may sit in an iframe; the payment page can't.
  const reserve = useMutation({
    ...orpc.booking.reserve.mutationOptions(),
    onSuccess: ({ confirmationUrl }) => leaveFrame(confirmationUrl),
    onError: async (error) => {
      toast.error(
        isDefinedError(error) ? error.message : "Не удалось начать оплату",
      );
      if (isDefinedError(error) && error.code === "ANSWERS_INVALID") {
        setAnswerErrors(error.data.errors);
        await refreshPractice();
      }
      if (isDefinedError(error) && error.code === "CONSENTS_REQUIRED") {
        // A document changed meanwhile: show the wording in force now.
        consents.reject(error.data.documentIds);
        await refreshPractice();
      }
    },
  });
  const reserveSeries = useMutation({
    ...orpc.booking.reserveSeries.mutationOptions(),
    onSuccess: ({ confirmationUrl }) => leaveFrame(confirmationUrl),
    onError: async (error) => {
      toast.error(
        isDefinedError(error) ? error.message : "Не удалось начать оплату",
      );
      if (isDefinedError(error) && error.code === "ANSWERS_INVALID") {
        setAnswerErrors(error.data.errors);
        await refreshPractice();
      }
      if (isDefinedError(error) && error.code === "CONSENTS_REQUIRED") {
        consents.reject(error.data.documentIds);
        await refreshPractice();
      }
      // Someone took a date meanwhile: show the dates as they are now.
      if (isDefinedError(error) && error.code === "SLOT_UNAVAILABLE") {
        await preview.refetch();
      }
    },
  });
  const leaving =
    reserve.isPending ||
    reserve.isSuccess ||
    reserveSeries.isPending ||
    reserveSeries.isSuccess;
  const confirmationUrl =
    reserve.data?.confirmationUrl ?? reserveSeries.data?.confirmationUrl;

  function submit(values: GuestBookingFormValues) {
    if (!selected) return;
    const { errors } = checkBookingAnswers(questions, answers);
    setAnswerErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (!consents.validate()) return;
    const booking = {
      ...values,
      answers,
      consents: consents.value(),
      note: values.note || undefined,
      practiceId: practice.id,
      packageId: selected.id,
      serviceId: service?.id,
      startsAt,
      timezone: timeZone,
    };
    if (repeat) reserveSeries.mutate({ ...booking, ...repeat, skip });
    else reserve.mutate(booking);
  }

  return (
    <form
      onSubmit={form.handleSubmit(submit)}
      className="flex flex-col gap-4"
      noValidate
    >
      <h2 className="text-base font-semibold">Ваши данные</h2>

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

      {questions.length > 0 && (
        <BookingQuestionFields
          questions={questions}
          values={answers}
          errors={answerErrors}
          onChange={setAnswers}
          idPrefix="guest-question"
        />
      )}

      {affordable >= 2 && (
        <div className="flex flex-col gap-3">
          <h3 className="pt-2 text-base font-semibold">Постоянное время</h3>
          <p className="text-sm text-muted-foreground">
            Закрепите это время за собой на несколько недель: все даты
            подтвердятся после одной оплаты.
          </p>
          <RepeatSelect
            value={repeat}
            onChange={(next) => {
              setRepeat(next);
              setUnchecked(new Set());
            }}
            max={affordable}
            idPrefix="guest-series"
          />
          {repeat && (
            <SeriesDateList
              query={preview}
              unchecked={unchecked}
              timeZone={timeZone}
              idPrefix="guest-series"
              onToggle={(at, checked) => {
                const next = new Set(unchecked);
                if (checked) next.delete(at.getTime());
                else next.add(at.getTime());
                setUnchecked(next);
              }}
            />
          )}
        </div>
      )}

      <h3 id="guest-package" className="pt-2 text-base font-semibold">
        Что оплатить
      </h3>
      {repeat && chosen.length < 2 ? (
        <p role="alert" className="text-sm text-muted-foreground">
          Оставьте хотя бы две даты.
        </p>
      ) : (
        deals.length === 0 && (
          <p role="alert" className="text-sm text-muted-foreground">
            {repeat
              ? "На все выбранные даты нет подходящего пакета. Оставьте меньше дат."
              : "Для этой услуги нет подходящего пакета. Выберите другую услугу или напишите специалисту."}
          </p>
        )
      )}
      <RadioGroup
        value={selected?.id ?? ""}
        onValueChange={(value) => setPackageId(String(value))}
        aria-labelledby="guest-package"
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
              {deal.credits > needed && (
                <span className="text-xs font-normal text-muted-foreground">
                  {repeat
                    ? `${formatCredits(needed, terms)} — на выбранные даты, остальные на вашем балансе`
                    : price > 1
                      ? `${formatCredits(price, terms)} — на выбранное время, остальные на вашем балансе`
                      : "Первая — на выбранное время, остальные на вашем балансе"}
                </span>
              )}
            </span>
            <span className="font-semibold tabular-nums">
              {formatRub(deal.price)}
            </span>
          </FieldLabel>
        ))}
      </RadioGroup>

      <ConsentFields consents={consents} idPrefix="guest" />

      <Button
        type="submit"
        size="lg"
        disabled={
          leaving || !selected || (repeat !== null && chosen.length < 2)
        }
      >
        {leaving && <Spinner />}
        {selected ? `Оплатить ${formatRub(selected.price)}` : "Оплатить"}
      </Button>
      {confirmationUrl && (
        <a
          href={confirmationUrl}
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
