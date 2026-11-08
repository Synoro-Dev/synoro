"use client";

import { paths } from "@synoro/config";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  cn,
  Progress,
  toast,
} from "@synoro/ui";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  CircleCheckIcon,
  CircleIcon,
  ListChecksIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";

import { orpc } from "~/orpc/react";
import { BookingLinkActions } from "./booking-link";
import { setupStepHref } from "./practice-setup-steps";

interface SetupPracticeSummary {
  id: string;
  imageUrl: string | null;
  bookingUrl: string;
  freeBookingEnabled: boolean;
}

/**
 * What this browser remembers about the checklist: hidden, and the steps the
 * owner ticked off by hand. Only a convenience — the setup itself stores
 * nothing, so a lost entry just shows the checklist again.
 */
interface Remembered {
  hidden?: boolean;
  marked?: string[];
}

const listeners = new Set<() => void>();

function storageKey(practiceId: string) {
  return `synoro:setup-checklist:${practiceId}`;
}

function readRaw(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parse(raw: string | null): Remembered {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null
      ? (value as Remembered)
      : {};
  } catch {
    return {};
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** The remembered state; empty on the server and before hydration. */
function useRemembered(practiceId: string) {
  const key = storageKey(practiceId);
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );
  const state = parse(raw);
  function update(next: Remembered) {
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Private mode or blocked storage: the change lasts until reload.
    }
    for (const listener of listeners) listener();
  }
  return [state, update] as const;
}

interface Step {
  id: string;
  title: string;
  description: string;
  /** Done by the data itself, not by a tick. */
  done: boolean;
  /** The owner may tick it off: the step is optional. */
  markable?: boolean;
  shown?: boolean;
  action?: { label: string; href: string };
}

/**
 * What is left before the booking page works on its own, as a checklist: one
 * step open at a time, with what it gives and where to do it. Shown to the
 * owner until every step is done or the list is hidden. This is how one
 * comes back to the first setup: it opens by itself only once, after
 * creating the practice.
 */
export function SetupProgress({
  practice,
  hasHours,
  hasClients,
  loaded,
}: {
  practice: SetupPracticeSummary;
  hasHours: boolean;
  hasClients: boolean;
  loaded: boolean;
}) {
  const [remembered, remember] = useRemembered(practice.id);
  const [open, setOpen] = useState<string[] | null>(null);
  const payments = useQuery(
    orpc.payment.settings.queryOptions({
      input: { practiceId: practice.id },
    }),
  );
  const offer = useQuery(
    orpc.payment.packages.queryOptions({
      input: { practiceId: practice.id },
    }),
  );
  if (!loaded || payments.isPending || offer.isPending) return null;
  if (remembered.hidden) return null;

  // Online payment counts only where the owner can set it up («Про», and
  // the server takes payments); a failed request is not a finished step.
  const canPay = payments.data
    ? payments.data.pro && payments.data.available
    : true;
  const marked = new Set(remembered.marked ?? []);
  const all: Step[] = [
    {
      id: "import",
      title: "Перенесите клиентов",
      description:
        "Из таблицы, календаря или другого сервиса. Клиенты ничего не получат, а загрузку можно отменить.",
      done: hasClients,
      markable: true,
      action: {
        label: "Перенести клиентов",
        href: setupStepHref(practice.id, "import"),
      },
    },
    {
      id: "hours",
      title: "Задайте рабочие часы",
      description:
        "Клиенты увидят свободное время только в эти часы. Перерывы и разные дни — потом, в расписании.",
      done: hasHours,
      action: {
        label: "Задать часы",
        href: setupStepHref(practice.id, "hours"),
      },
    },
    {
      id: "prices",
      title: "Укажите цены или включите бесплатную запись",
      description:
        "Разовая цена, пакет со скидкой или бесплатная первая встреча.",
      done:
        (offer.data?.packages.length ?? 0) > 0 || practice.freeBookingEnabled,
      shown: canPay,
      action: {
        label: "Указать цены",
        href: setupStepHref(practice.id, "prices"),
      },
    },
    {
      id: "photo",
      title: "Добавьте фото на страницу записи",
      description: "Клиенту спокойнее записаться, когда он видит, к кому идёт.",
      done: !!practice.imageUrl,
      markable: true,
      action: {
        label: "Добавить фото",
        href: paths.booking.page(practice.id),
      },
    },
    {
      id: "payment",
      title: "Подключите онлайн-оплату",
      description:
        "Клиенты платят сами при записи — без переводов и напоминаний.",
      done: !!payments.data?.account,
      markable: true,
      shown: canPay,
      action: {
        label: "Подключить оплату",
        href: paths.booking.onlinePayment(practice.id),
      },
    },
    {
      id: "link",
      title: "Отправьте ссылку первому клиенту",
      description:
        "Клиент выберет время сам, без регистрации. Шаг отметится, когда он запишется.",
      done: hasClients,
      markable: true,
    },
  ];
  const steps = all.filter((s) => s.shown !== false);

  const isDone = (s: Step) => s.done || (!!s.markable && marked.has(s.id));
  const done = steps.filter(isDone).length;
  if (done === steps.length) return null;
  const firstLeft = steps.find((s) => !isDone(s));
  const value = open ?? (firstLeft ? [firstLeft.id] : []);

  function mark(step: Step, on: boolean) {
    const next = new Set(marked);
    if (on) next.add(step.id);
    else next.delete(step.id);
    remember({ ...remembered, marked: [...next] });
    if (on) {
      // On to the next step that is left, as a checklist does.
      const after = steps.find((s) => s !== step && !isDone(s));
      setOpen(after ? [after.id] : []);
    }
  }

  function hide() {
    remember({ ...remembered, hidden: true });
    toast("Чек-лист скрыт", {
      description: "Все шаги есть в настройках практики",
      action: {
        label: "Вернуть",
        onClick: () => remember({ ...remembered, hidden: false }),
      },
    });
  }

  return (
    <Frame spacing="default">
      <FramePanel className="flex flex-col gap-4">
        <FrameHeader className="flex-row items-center justify-between gap-4 p-0">
          <div className="flex min-w-0 items-center gap-3">
            <ListChecksIcon
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <FrameTitle>Запуск практики</FrameTitle>
              <FrameDescription className="text-xs">
                около 10 минут
              </FrameDescription>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              Готово {done} из {steps.length}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Скрыть чек-лист"
              onClick={hide}
            >
              <XIcon />
            </Button>
          </div>
        </FrameHeader>
        <Progress
          value={(done / steps.length) * 100}
          aria-label={`Запуск практики: готово ${done} из ${steps.length}`}
          className="[&_[data-slot=progress-indicator]]:bg-brand"
        />
        <Accordion value={value} onValueChange={(v) => setOpen(v as string[])}>
          {steps.map((step) => {
            const complete = isDone(step);
            const byHand = complete && !step.done;
            return (
              <AccordionItem
                key={step.id}
                value={step.id}
                className="last:border-b-0"
              >
                <AccordionTrigger className="gap-3 py-3 hover:no-underline">
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    {complete ? (
                      <CircleCheckIcon
                        className="size-4 shrink-0 text-brand"
                        aria-hidden
                      />
                    ) : (
                      <CircleIcon
                        className="size-4 shrink-0 text-muted-foreground/60"
                        aria-hidden
                      />
                    )}
                    <span className="sr-only">
                      {complete ? "Готово: " : "Не сделано: "}
                    </span>
                    <span
                      className={cn(
                        "min-w-0",
                        complete &&
                          "text-muted-foreground line-through decoration-muted-foreground/60",
                      )}
                    >
                      {step.title}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="flex flex-col gap-3 pl-7">
                  <p className="text-muted-foreground">{step.description}</p>
                  {step.id === "link" && !complete && (
                    <BookingLinkActions url={practice.bookingUrl} />
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {step.action && !step.done && (
                      <Button
                        size="sm"
                        nativeButton={false}
                        render={<Link href={step.action.href as Route} />}
                      >
                        {step.action.label}
                        <ArrowRightIcon />
                      </Button>
                    )}
                    {step.markable && !step.done && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => mark(step, !byHand)}
                      >
                        {byHand ? (
                          <>
                            <Undo2Icon />
                            Вернуть в список
                          </>
                        ) : (
                          <>
                            <CircleCheckIcon />
                            Отметить выполненным
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </FramePanel>
    </Frame>
  );
}
