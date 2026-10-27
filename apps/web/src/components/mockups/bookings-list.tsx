import { cn } from "@acme/ui";
import { LockIcon, MoreHorizontalIcon } from "lucide-react";

import { Initials } from "~/components/landing/primitives";

type Row = {
  when: string;
  who: string;
  note: string;
  kind: "consultation" | "free" | "blocked";
  extra?: string;
};

const rows: Row[] = [
  {
    when: "Чт, 12 нояб · 13:00–14:00",
    who: "Ольга Петрова",
    note: "olga.petrova@example.com",
    kind: "consultation",
    extra: "3 в пакете",
  },
  {
    when: "Чт, 12 нояб · 15:00–15:30",
    who: "Ирина Лебедева",
    note: "+7 916 123-45-67",
    kind: "free",
  },
  {
    when: "Пт, 13 нояб · 09:00–12:00",
    who: "Личное время",
    note: "Супервизия",
    kind: "blocked",
  },
  {
    when: "Пт, 13 нояб · 14:00–15:00",
    who: "Дмитрий Иванов",
    note: "dmitry.ivanov@example.com",
    kind: "consultation",
    extra: "1 в пакете",
  },
];

const kinds = {
  consultation: {
    label: "Консультация · 60 мин",
    className: "bg-violet-50 text-violet-700 ring-violet-600/15",
  },
  free: {
    label: "Знакомство · 30 мин",
    className: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  },
  blocked: {
    label: "Закрыто",
    className: "bg-zinc-100 text-zinc-600 ring-zinc-500/15",
  },
} as const;

const offsets = ["md:ml-0", "md:ml-10", "md:ml-20", "md:ml-10"];

/** Staggered list of a specialist's upcoming bookings. */
export function BookingsListMockup() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      {rows.map((row, index) => (
        <div
          key={row.when}
          className={cn(
            "bg-background flex items-center gap-3 rounded-xl border p-3 pr-4 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.12)] md:max-w-[680px]",
            offsets[index],
          )}
        >
          {row.kind === "blocked" ? (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 ring-1 ring-black/5">
              <LockIcon className="size-3.5" />
            </span>
          ) : (
            <Initials name={row.who} />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {row.who}
              <span className="text-muted-foreground hidden font-normal sm:inline">
                {" "}
                · {row.note}
              </span>
            </p>
            <p className="text-muted-foreground text-xs tabular-nums">
              {row.when}
            </p>
          </div>
          {row.extra && (
            <span className="text-muted-foreground hidden rounded-md border px-1.5 py-0.5 text-xs sm:inline">
              {row.extra}
            </span>
          )}
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
              kinds[row.kind].className,
            )}
          >
            {kinds[row.kind].label}
          </span>
          <MoreHorizontalIcon className="text-muted-foreground hidden size-4 sm:block" />
        </div>
      ))}
    </div>
  );
}
