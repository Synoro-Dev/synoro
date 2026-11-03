import { Button } from "@synoro/ui";
import { ArrowLeftIcon } from "lucide-react";

import { formatTime, viewerTimeZoneName } from "./time";

/**
 * The chosen time beside the booking form on the public page: the day, the
 * hour set large, and the way back to the list of times.
 */
export function BookingTicket({
  startsAt,
  endsAt,
  timeZone,
  what,
  onBack,
}: {
  startsAt: Date;
  endsAt: Date;
  /** The zone the time is shown in. */
  timeZone: string;
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
          {startsAt.toLocaleDateString("ru-RU", {
            timeZone,
            weekday: "long",
          })}
        </p>
        <p className="font-display text-2xl">
          {startsAt.toLocaleDateString("ru-RU", {
            timeZone,
            day: "numeric",
            month: "long",
          })}
        </p>
        <p className="font-display text-6xl leading-none font-medium tracking-tight tabular-nums">
          {formatTime(startsAt, timeZone)}
        </p>
        <p className="pt-2 text-sm text-muted-foreground">
          {what} до {formatTime(endsAt, timeZone)} ·{" "}
          {viewerTimeZoneName(timeZone)}
        </p>
      </div>
    </section>
  );
}
