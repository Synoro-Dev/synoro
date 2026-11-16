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
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@synoro/ui";
import {
  type ConsentsInput,
  formatCredits,
  type ProfessionTerms,
} from "@synoro/validators";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { formatDateTime } from "./time";

const INTERVALS: Record<string, string> = {
  "1": "Каждую неделю",
  "2": "Раз в две недели",
};

/**
 * A client pins the chosen time for good («Про»): the same time every week or
 * every other week until they cancel. The next four weeks are booked now from
 * the balance; the rest follows by itself, a package at a time.
 */
export function StandingDialog({
  practiceId,
  startsAt,
  timeZone,
  credits,
  serviceId,
  price,
  terms,
  answers,
  consents,
  onAnswersInvalid,
  onConsentsRequired,
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
  /** The documents ticked on the booking page (`useConsents().value()`). */
  consents: ConsentsInput;
  /** The server rejected `answers`: an error per question id. */
  onAnswersInvalid: (errors: Record<string, string>) => void;
  /** The server wants these documents accepted first. */
  onConsentsRequired: (documentIds: string[]) => void;
  onClose: () => void;
  onBooked: (dates: Date[]) => void;
}) {
  const [interval, setInterval] = useState<"1" | "2">("1");
  const pin = useMutation({
    ...orpc.standing.create.mutationOptions(),
    onSuccess: (result) => {
      if (result.held > 0) {
        toast.message(
          "Пакет закончится раньше: часть дат закреплена за вами до оплаты.",
        );
      }
      onBooked(result.dates);
    },
    onError: (error) => {
      toast.error(error.message || "Не удалось закрепить время");
      if (isDefinedError(error) && error.code === "ANSWERS_INVALID") {
        onAnswersInvalid(error.data.errors);
      }
      if (isDefinedError(error) && error.code === "CONSENTS_REQUIRED") {
        onConsentsRequired(error.data.documentIds);
      }
    },
  });

  return (
    <Dialog
      open={startsAt !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="sm:max-w-md">
        {startsAt && (
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              pin.mutate({
                practiceId,
                startsAt,
                serviceId,
                intervalWeeks: interval === "1" ? 1 : 2,
                answers,
                consents,
                timezone: timeZone,
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Закрепить это время</DialogTitle>
              <DialogDescription>
                {formatDateTime(startsAt, timeZone)} — и дальше в то же время,
                пока вы не отмените.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="standing-interval">Как часто</Label>
              <Select
                items={INTERVALS}
                value={interval}
                onValueChange={(next) => setInterval(next === "2" ? "2" : "1")}
              >
                <SelectTrigger id="standing-interval" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(INTERVALS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
              <li>
                Ближайшие четыре недели записываются сразу: за каждую дату
                спишется {formatCredits(price, terms)}, на балансе{" "}
                {formatCredits(credits, terms)}.
              </li>
              <li>
                Дальше даты добавляются сами, по мере того как идут недели.
              </li>
              <li>
                Когда занятия закончатся, время держится за вами до 48 часов до
                встречи. Оплатите пакет — иначе оно освободится, а постоянное
                время встанет на паузу.
              </li>
              <li>Отменить можно в любой момент в личном кабинете.</li>
            </ul>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Отмена
              </Button>
              <Button type="submit" disabled={pin.isPending}>
                Закрепить время
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
