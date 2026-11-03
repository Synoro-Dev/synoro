"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { isDefinedError } from "@orpc/client";
import { Button, Input, Label, Spinner, Textarea, toast } from "@synoro/ui";
import {
  type BookingQuestion,
  checkBookingAnswers,
  type GuestBookingFormInput,
  type GuestBookingFormValues,
  guestBookingFormSchema,
  normalizePhone,
} from "@synoro/validators";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GiftIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { BookingLegalNotice } from "~/components/legal-links";
import { orpc } from "~/orpc/react";
import { BookingQuestionFields } from "./booking-question-fields";

const SUBMIT = "Записаться бесплатно";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  );
}

/**
 * Booking the free intro on the booking page: a visitor leaves name, phone
 * and email, a signed-in client only confirms (and leaves a phone if the
 * profile has none). No payment — the booking is confirmed at once and the
 * link to it goes to the email. `onTaken` is called when someone else got
 * the time first.
 */
export function IntroBookingForm({
  practiceId,
  intro,
  length,
  startsAt,
  signedIn,
  needsPhone,
  questions,
  onBooked,
  onTaken,
}: {
  practiceId: string;
  /** The intro's name for this profession: «Пробная тренировка». */
  intro: string;
  /** How long it lasts: «30 минут», «1 час». */
  length: string;
  startsAt: Date;
  signedIn: boolean;
  needsPhone: boolean;
  questions: BookingQuestion[];
  onBooked: (booking: { token: string; startsAt: Date }) => void;
  onTaken: () => void;
}) {
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");

  const form = useForm<GuestBookingFormInput, unknown, GuestBookingFormValues>({
    resolver: zodResolver(guestBookingFormSchema),
    defaultValues: { name: "", phone: "", email: "", note: "" },
  });
  const { errors } = form.formState;

  const savePhone = useMutation({
    ...orpc.user.updatePhone.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orpc.user.key() }),
    onError: (error) => toast.error(error.message),
  });
  const book = useMutation({
    ...orpc.booking.bookIntro.mutationOptions(),
    onSuccess: (booking) => onBooked(booking),
    onError: async (error) => {
      toast.error(
        isDefinedError(error) ? error.message : "Не удалось записаться",
      );
      if (!isDefinedError(error)) return;
      if (error.code === "ANSWERS_INVALID") {
        setAnswerErrors(error.data.errors);
        await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
      }
      if (error.code === "SLOT_UNAVAILABLE") onTaken();
    },
  });
  const pending = book.isPending || savePhone.isPending;

  /** The questionnaire is filled in; otherwise its errors are shown. */
  function answered() {
    const { errors } = checkBookingAnswers(questions, answers);
    setAnswerErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function submitGuest(values: GuestBookingFormValues) {
    if (!answered()) return;
    const { note, ...guest } = values;
    book.mutate({
      practiceId,
      startsAt,
      guest,
      note: note || undefined,
      answers,
    });
  }

  async function submitSignedIn(event: React.FormEvent) {
    event.preventDefault();
    if (!answered()) return;
    if (needsPhone) {
      const normalized = normalizePhone(phone);
      if (!normalized) {
        toast.error("Укажите номер телефона, например +7 900 123-45-67");
        return;
      }
      await savePhone.mutateAsync({ phone: normalized });
    }
    book.mutate({ practiceId, startsAt, note: note || undefined, answers });
  }

  const questionnaire = questions.length > 0 && (
    <BookingQuestionFields
      questions={questions}
      values={answers}
      errors={answerErrors}
      onChange={setAnswers}
      idPrefix="intro-question"
    />
  );
  const footer = (
    <>
      <Button type="submit" size="lg" disabled={pending}>
        {pending && <Spinner />}
        {SUBMIT}
      </Button>
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <GiftIcon className="mt-0.5 size-3 shrink-0" />
        <span>
          {intro} — {length}, без оплаты, один раз. Ссылка на запись придёт на
          почту: по ней её можно отменить.
        </span>
      </p>
      <BookingLegalNotice action={SUBMIT} />
    </>
  );

  if (signedIn) {
    return (
      <form onSubmit={submitSignedIn} className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Подтвердите запись</h2>
        {needsPhone && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="intro-phone">Телефон</Label>
            <Input
              id="intro-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+7 900 123-45-67"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="intro-note">Комментарий</Label>
          <Textarea
            id="intro-note"
            rows={2}
            placeholder="С чем хотите прийти — необязательно"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {questionnaire}
        {footer}
      </form>
    );
  }

  return (
    <form
      onSubmit={form.handleSubmit(submitGuest)}
      className="flex flex-col gap-4"
      noValidate
    >
      <h2 className="text-base font-semibold">Ваши данные</h2>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="intro-name">Имя</Label>
        <Input
          id="intro-name"
          autoComplete="name"
          placeholder="Иван Петров"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "intro-name-error" : undefined}
          {...form.register("name")}
        />
        <FieldError id="intro-name-error" message={errors.name?.message} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="intro-guest-phone">Телефон</Label>
        <Input
          id="intro-guest-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+7 900 123-45-67"
          aria-invalid={!!errors.phone}
          aria-describedby={errors.phone ? "intro-phone-error" : undefined}
          {...form.register("phone")}
        />
        <FieldError id="intro-phone-error" message={errors.phone?.message} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="intro-email">Электронная почта</Label>
        <Input
          id="intro-email"
          type="email"
          autoComplete="email"
          placeholder="ivan@example.com"
          aria-invalid={!!errors.email}
          aria-describedby={
            errors.email ? "intro-email-error" : "intro-email-hint"
          }
          {...form.register("email")}
        />
        <FieldError id="intro-email-error" message={errors.email?.message} />
        {!errors.email && (
          <p id="intro-email-hint" className="text-xs text-muted-foreground">
            Пришлём ссылку на запись. По ней же — вход в личный кабинет.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="intro-guest-note">Комментарий</Label>
        <Textarea
          id="intro-guest-note"
          rows={2}
          placeholder="С чем хотите прийти — необязательно"
          {...form.register("note")}
        />
      </div>

      {questionnaire}
      {footer}
    </form>
  );
}
