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
  credits,
  terms,
  onClose,
  onBooked,
}: {
  practiceId: string;
  /** The picked slot; null while the dialog is closed. */
  startsAt: Date | null;
  credits: number;
  terms: ProfessionTerms;
  onClose: () => void;
  onBooked: (dates: Date[]) => void;
}) {
  return (
    <Dialog
      open={startsAt !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="sm:max-w-md">
        {startsAt && (
          <SeriesForm
            practiceId={practiceId}
            startsAt={startsAt}
            credits={credits}
            terms={terms}
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
  credits,
  terms,
  onBooked,
  onCancel,
}: {
  practiceId: string;
  startsAt: Date;
  credits: number;
  terms: ProfessionTerms;
  onBooked: (dates: Date[]) => void;
  onCancel: () => void;
}) {
  const [repeat, setRepeat] = useState<Repeat | null>({
    intervalWeeks: 1,
    count: Math.min(credits, 4),
  });
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());
  const preview = useSeriesPreview({ practiceId, startsAt, repeat });
  const { chosen, skip } = seriesChoice(preview.data?.dates ?? [], unchecked);

  const book = useMutation({
    ...orpc.booking.bookSeries.mutationOptions(),
    onSuccess: (result) => onBooked(result.dates),
    onError: async (error) => {
      toast.error(error.message || "Не удалось записаться");
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
        book.mutate({ practiceId, startsAt, ...repeat, skip });
      }}
    >
      <DialogHeader>
        <DialogTitle>Повторять запись</DialogTitle>
        <DialogDescription>
          {formatDateTime(startsAt)} — и дальше в то же время. За каждую дату
          спишется {formatCredits(1, terms)}, на балансе{" "}
          {formatCredits(credits, terms)}.
        </DialogDescription>
      </DialogHeader>

      <RepeatSelect
        value={repeat}
        onChange={(next) => {
          setRepeat(next);
          setUnchecked(new Set());
        }}
        max={credits}
        idPrefix="series"
      />

      {repeat && (
        <SeriesDateList
          query={preview}
          unchecked={unchecked}
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
            ? `Записаться: ${formatCredits(chosen.length, terms)}`
            : "Выберите хотя бы две даты"}
        </Button>
      </DialogFooter>
    </form>
  );
}
