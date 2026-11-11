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
  toast,
} from "@synoro/ui";
import { formatCredits, type ProfessionTerms } from "@synoro/validators";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import {
  type Repeat,
  RepeatSelect,
  SeriesDateList,
  seriesChoice,
  useSeriesPreview,
} from "./series-fields";
import { formatDateTime } from "./time";

/**
 * A client books the same time every week (or every other week) from their
 * balance: pick how often and how many times, check the dates, confirm.
 */
export function SeriesDialog({
  practiceId,
  startsAt,
  timeZone,
  credits,
  serviceId,
  price,
  terms,
  answers,
  onAnswersInvalid,
  onClose,
  onBooked,
}: {
  practiceId: string;
  /** The picked slot; null while the dialog is closed. */
  startsAt: Date | null;
  /** The zone the client reads times in; their mails use it too. */
  timeZone: string;
  credits: number;
  /** The service being booked; the practice's first when missing. */
  serviceId?: string;
  /** What one booking of it costs, in credits. */
  price: number;
  terms: ProfessionTerms;
  /** The questionnaire, already filled in on the booking page. */
  answers: Record<string, string>;
  /** The server rejected `answers`: an error per question id. */
  onAnswersInvalid: (errors: Record<string, string>) => void;
  onClose: () => void;
  onBooked: (dates: Date[]) => void;
}) {
  return (
    <Dialog
      open={startsAt !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        {startsAt && (
          <SeriesForm
            practiceId={practiceId}
            startsAt={startsAt}
            timeZone={timeZone}
            credits={credits}
            serviceId={serviceId}
            price={price}
            terms={terms}
            answers={answers}
            onAnswersInvalid={onAnswersInvalid}
            onBooked={onBooked}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SeriesForm({
  practiceId,
  startsAt,
  timeZone,
  credits,
  serviceId,
  price,
  terms,
  answers,
  onAnswersInvalid,
  onBooked,
  onCancel,
}: {
  practiceId: string;
  startsAt: Date;
  timeZone: string;
  credits: number;
  serviceId?: string;
  price: number;
  terms: ProfessionTerms;
  answers: Record<string, string>;
  onAnswersInvalid: (errors: Record<string, string>) => void;
  onBooked: (dates: Date[]) => void;
  onCancel: () => void;
}) {
  // How many dates the balance pays for.
  const affordable = Math.floor(credits / price);
  const [repeat, setRepeat] = useState<Repeat | null>({
    intervalWeeks: 1,
    count: Math.min(affordable, 4),
  });
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());
  const preview = useSeriesPreview({
    practiceId,
    startsAt,
    repeat,
    serviceId,
  });
  const { chosen, skip } = seriesChoice(preview.data?.dates ?? [], unchecked);

  const book = useMutation({
    ...orpc.booking.bookSeries.mutationOptions(),
    onSuccess: (result) => onBooked(result.dates),
    onError: async (error) => {
      toast.error(error.message || "Не удалось записаться");
      if (isDefinedError(error) && error.code === "ANSWERS_INVALID") {
        onAnswersInvalid(error.data.errors);
        return;
      }
      if (isDefinedError(error) && error.code === "SLOT_UNAVAILABLE") {
        await preview.refetch();
      }
    },
  });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!repeat) return;
        book.mutate({
          practiceId,
          startsAt,
          serviceId,
          ...repeat,
          skip,
          answers,
          timezone: timeZone,
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>Повторять запись</DialogTitle>
        <DialogDescription>
          {formatDateTime(startsAt, timeZone)} — и дальше в то же время. За
          каждую дату спишется {formatCredits(price, terms)}, на балансе{" "}
          {formatCredits(credits, terms)}.
        </DialogDescription>
      </DialogHeader>

      <RepeatSelect
        value={repeat}
        onChange={(next) => {
          setRepeat(next);
          setUnchecked(new Set());
        }}
        max={affordable}
        idPrefix="series"
      />

      {repeat && (
        <SeriesDateList
          query={preview}
          unchecked={unchecked}
          timeZone={timeZone}
          idPrefix="series"
          onToggle={(at, checked) => {
            const next = new Set(unchecked);
            if (checked) next.delete(at.getTime());
            else next.add(at.getTime());
            setUnchecked(next);
          }}
        />
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Отмена
        </Button>
        <Button
          type="submit"
          disabled={!repeat || chosen.length < 2 || book.isPending}
        >
          {chosen.length >= 2
            ? `Записаться: ${formatCredits(chosen.length * price, terms)}`
            : "Выберите хотя бы две даты"}
        </Button>
      </DialogFooter>
    </form>
  );
}
