import { Button } from "@synoro/ui";
import { ArrowLeftIcon } from "lucide-react";

import { formatTime } from "./time";

/**
 * The chosen time beside the booking form on the public page: the day, the
 * hour set large, and the way back to the list of times.
 */
export function BookingTicket({
  startsAt,
  endsAt,
  what,
  onBack,
}: {
  startsAt: Date;
  endsAt: Date;
  /** «Консультация», «Занятие»: the profession's word for a booking. */
  what: string;
  onBack: () => void;
}) {
  return (
    <section className="flex flex-col gap-6 border-b bg-muted/40 p-6 md:border-r md:border-b-0 dark:bg-muted/20">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2.5 self-start"
        onClick={onBack}
      >
        <ArrowLeftIcon />
        Другое время
      </Button>
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground first-letter:uppercase">
          {startsAt.toLocaleDateString("ru-RU", { weekday: "long" })}
        </p>
        <p className="font-display text-2xl">
          {startsAt.toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "long",
          })}
        </p>
        <p className="font-display text-6xl leading-none font-medium tracking-tight tabular-nums">
          {formatTime(startsAt)}
        </p>
        <p className="pt-2 text-sm text-muted-foreground">
          {what} до {formatTime(endsAt)}
        </p>
      </div>
    </section>
  );
}
