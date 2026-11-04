"use client";

import { paths } from "@synoro/config";
import type { MemberRole } from "@synoro/db";
import { Button, cn, Progress, Skeleton } from "@synoro/ui";
import { Badge } from "@synoro/ui/reui/badge";
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
  CalendarClockIcon,
  CalendarDaysIcon,
  CalendarPlusIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  Clock3Icon,
  LockIcon,
  VideoIcon,
  WalletIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import {
  BookingDialog,
  bookingTitle,
  type CalendarBooking,
  kindLabel,
} from "./booking-dialog";
import { BookingLinkActions } from "./booking-link";
import { EntryDialog, type EntryDraft } from "./entry-dialog";
import { setupStepHref } from "./practice-setup-steps";
import { EmptyState, ErrorState } from "./states";
import { useTerms } from "./terms";
import { dateKey, formatTime } from "./time";

const WEEK = 7;

/** The next half hour from now: where a new entry starts by default. */
function nextHalfHour() {
  const at = new Date();
  at.setSeconds(0, 0);
  at.setMinutes(at.getMinutes() < 30 ? 30 : 60);
  return at;
}

interface PracticeSummary {
  id: string;
  name: string;
  imageUrl: string | null;
  bookingUrl: string;
  timezone: string;
  videoUrl: string | null;
  membership: { role: MemberRole };
}

/**
 * «Сегодня»: what the day holds, what needs a hand, and the two things one
 * does from here — book a client, close time. Until the practice is set up,
 * its owner also sees what is left to do.
 */
export function PracticeOverview({ practice }: { practice: PracticeSummary }) {
  const terms = useTerms();
  const owner = practice.membership.role === "owner";
  // Calendar days in the viewer's zone. Each bound is built from the date
  // itself, not +24 h or a copied time: DST days are 23 or 25 hours long,
  // and where the clock jumps at midnight a copied time would drift.
  const now = new Date();
  const [y, m, d] = [now.getFullYear(), now.getMonth(), now.getDate()];
  const dayStart = new Date(y, m, d);
  const dayEnd = new Date(y, m, d + 1);
  const tomorrowEnd = new Date(y, m, d + 2);
  // The API counts days in the practice's zone: start on the practice date
  // of the viewer's midnight, so a viewer west of the practice misses
  // nothing of their morning, and fetch a day more to cover tomorrow.
  const from = dateKey(dayStart, practice.timezone);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [selected, setSelected] = useState<CalendarBooking | null>(null);

  const calendar = useQuery(
    orpc.booking.calendar.queryOptions({
      input: { practiceId: practice.id, from, days: WEEK + 1 },
    }),
  );
  const members = useQuery(
    orpc.practice.members.queryOptions({ input: { practiceId: practice.id } }),
  );
  const rules = useQuery(
    orpc.availability.list.queryOptions({ input: { practiceId: practice.id } }),
  );

  const entries = calendar.data ?? [];
  // Everything that touches today — a vacation closed days ago included.
  const today = entries.filter(
    (b) => b.startsAt < dayEnd && b.endsAt > dayStart,
  );
  const tomorrow = entries.filter(
    (b) =>
      b.kind !== "blocked" && b.startsAt >= dayEnd && b.startsAt < tomorrowEnd,
  );
  const meetingsToday = today.filter((b) => b.kind !== "blocked").length;
  const credits = new Map(
    (members.data ?? []).map((m) => [m.id, m.credits] as const),
  );

  function open(mode: EntryDraft["mode"]) {
    const start = nextHalfHour();
    setDraft({
      mode,
      start,
      end: new Date(start.getTime() + 60 * 60_000),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight first-letter:uppercase">
            {now.toLocaleDateString("ru-RU", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {calendar.isPending
              ? "Загружаем записи…"
              : meetingsToday === 0
                ? "Сегодня записей нет"
                : `Записей сегодня: ${meetingsToday}`}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button variant="outline" onClick={() => open("block")}>
            <LockIcon />
            Закрыть время
          </Button>
          <Button onClick={() => open("consultation")}>
            <CalendarPlusIcon />
            Записать
          </Button>
        </div>
      </div>

      {owner && (
        <SetupProgress
          practice={practice}
          hasHours={(rules.data?.length ?? 0) > 0}
          hasClients={(members.data ?? []).some((m) => m.role === "client")}
          loaded={rules.isSuccess && members.isSuccess}
        />
      )}

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Frame spacing="default" className="min-w-0">
          <FramePanel className="flex flex-col gap-3">
            <FrameHeader className="flex-row items-center justify-between p-0">
              <FrameTitle>Сегодня</FrameTitle>
              <Button
                size="sm"
                variant="ghost"
                nativeButton={false}
                render={<Link href={paths.booking.calendar(practice.id)} />}
              >
                Календарь
                <ArrowRightIcon />
              </Button>
            </FrameHeader>

            {calendar.isError ? (
              <ErrorState onRetry={() => calendar.refetch()} />
            ) : calendar.isPending ? (
              <div className="flex flex-col gap-2">
                {["a", "b", "c"].map((k) => (
                  <Skeleton key={k} className="h-16 w-full" />
                ))}
              </div>
            ) : today.length === 0 ? (
              <EmptyState
                icon={CalendarDaysIcon}
                title="День свободен"
                description={
                  entries.some((b) => b.kind !== "blocked")
                    ? "Ближайшие записи — в календаре."
                    : "Отправьте клиентам ссылку на страницу записи — они выберут время сами."
                }
              />
            ) : (
              <ul className="-mx-2 flex flex-col">
                {today.map((b) => (
                  <DayRow
                    key={b.id}
                    booking={b}
                    now={now}
                    day={[dayStart, dayEnd]}
                    credits={b.memberId ? credits.get(b.memberId) : undefined}
                    label={kindLabel(b.kind, terms)}
                    onOpen={() => setSelected(b)}
                  />
                ))}
              </ul>
            )}
          </FramePanel>
        </Frame>

        <div className="flex min-w-0 flex-col gap-6">
          <Attention
            practiceId={practice.id}
            entries={entries}
            members={members.data}
            hasHours={rules.data ? rules.data.length > 0 : true}
            owner={owner}
          />
          <Frame spacing="default">
            <FramePanel className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">Завтра</span>
              <span className="text-base font-medium">
                {calendar.isPending
                  ? "…"
                  : tomorrow.length === 0
                    ? "Записей нет"
                    : `Записей: ${tomorrow.length}, первая в ${formatTime(
                        tomorrow[0]?.startsAt ?? now,
                      )}`}
              </span>
            </FramePanel>
          </Frame>
          <BookingLink practice={practice} />
        </div>
      </div>

      <EntryDialog
        practiceId={practice.id}
        timezone={practice.timezone}
        draft={draft}
        onClose={() => setDraft(null)}
      />
      <BookingDialog booking={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

/** One entry of the day: time, who, what's left on their balance. */
function DayRow({
  booking: b,
  now,
  day: [dayStart, dayEnd],
  credits,
  label,
  onOpen,
}: {
  booking: CalendarBooking;
  now: Date;
  /** Today's bounds: a block may start before it or end after it. */
  day: [Date, Date];
  /** The client's balance, for a paid booking. */
  credits: number | undefined;
  label: string;
  onOpen: () => void;
}) {
  const current = b.startsAt <= now && b.endsAt > now;
  const past = b.endsAt <= now;
  const blocked = b.kind === "blocked";
  const allDay = b.startsAt <= dayStart && b.endsAt >= dayEnd;

  return (
    <li className="relative flex items-center gap-1">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:bg-muted/50",
          past && "opacity-60",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "h-10 w-1 shrink-0 rounded-full",
            current
              ? "bg-brand"
              : blocked
                ? "bg-[repeating-linear-gradient(45deg,var(--border)_0_3px,transparent_3px_6px)]"
                : b.kind === "free"
                  ? "border border-dashed border-muted-foreground/50"
                  : "bg-brand/30",
          )}
        />
        <span className="w-12 shrink-0 text-sm font-medium tabular-nums">
          {allDay ? (
            <span aria-hidden="true">—</span>
          ) : (
            formatTime(b.startsAt < dayStart ? dayStart : b.startsAt)
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">
            {current && <span className="sr-only">Сейчас: </span>}
            {bookingTitle(b)}
          </span>
          <span className="text-sm text-muted-foreground">
            <span className="tabular-nums">
              {allDay
                ? "Весь день"
                : `до ${formatTime(b.endsAt >= dayEnd ? dayEnd : b.endsAt)}`}{" "}
              · {label}
            </span>
            {b.videoUrl && !blocked && " · онлайн"}
            {credits !== undefined && (
              <span
                className={cn(
                  "whitespace-nowrap",
                  credits === 0 && "text-warning-foreground",
                )}
              >
                {" "}
                · на балансе {credits}
              </span>
            )}
          </span>
        </span>
        {current && (
          <Badge variant="success-light" className="shrink-0">
            Сейчас
          </Badge>
        )}
        {b.holdUntil && (
          <Badge variant="warning-light" className="shrink-0">
            Ждёт оплаты
          </Badge>
        )}
      </button>
      {b.videoUrl && !blocked && !past && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Войти на встречу: ${bookingTitle(b)}`}
          nativeButton={false}
          render={
            <a href={b.videoUrl} target="_blank" rel="noreferrer noopener" />
          }
        >
          <VideoIcon />
        </Button>
      )}
    </li>
  );
}

/**
 * What needs a hand this week. Quiet when nothing does — an empty list of
 * problems is good news, said once.
 */
function Attention({
  practiceId,
  entries,
  members = [],
  hasHours,
  owner,
}: {
  practiceId: string;
  entries: CalendarBooking[];
  members?: { id: string; name: string; credits: number; role: MemberRole }[];
  hasHours: boolean;
  owner: boolean;
}) {
  const terms = useTerms();
  const awaiting = entries.filter((b) => b.holdUntil !== null);
  const booked = new Set(entries.map((b) => b.memberId));
  // Clients coming this week whose balance has run out.
  const empty = members.filter(
    (m) => m.role === "client" && m.credits === 0 && booked.has(m.id),
  );

  const items: {
    key: string;
    text: string;
    href: Route;
    icon: typeof Clock3Icon;
  }[] = [];
  if (!hasHours && !owner) {
    items.push({
      key: "hours",
      text: "Рабочие часы не заданы — клиенты не видят свободного времени",
      href: paths.booking.schedule(practiceId) as Route,
      icon: Clock3Icon,
    });
  }
  if (awaiting.length > 0) {
    items.push({
      key: "awaiting",
      text: `Ждут оплаты: ${awaiting.length}`,
      href: paths.booking.calendar(practiceId) as Route,
      icon: CalendarClockIcon,
    });
  }
  if (empty.length > 0) {
    items.push({
      key: "empty",
      text: `Оплаченные ${terms.credits} закончились: ${empty
        .slice(0, 3)
        .map((m) => m.name)
        .join(", ")}${empty.length > 3 ? ` и ещё ${empty.length - 3}` : ""}`,
      href: paths.booking.clients(practiceId) as Route,
      icon: WalletIcon,
    });
  }

  return (
    <Frame spacing="default">
      <FramePanel className="flex flex-col gap-2">
        <FrameTitle>Требует внимания</FrameTitle>
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleCheckIcon className="size-4 text-brand" aria-hidden />
            Всё в порядке
          </p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {items.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="flex min-h-11 items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:bg-muted/50"
                >
                  <item.icon
                    className="size-4 shrink-0 text-warning-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">{item.text}</span>
                  <ArrowRightIcon
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </FramePanel>
    </Frame>
  );
}

/**
 * What is left before the booking page works on its own. Shown to the
 * owner until every step is done, then gone for good. This is how one comes
 * back to the first setup: it opens by itself only once, after creating the
 * practice.
 */
function SetupProgress({
  practice,
  hasHours,
  hasClients,
  loaded,
}: {
  practice: PracticeSummary;
  hasHours: boolean;
  hasClients: boolean;
  loaded: boolean;
}) {
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

  // Online payment counts only where the owner can set it up («Про», and
  // the server takes payments); a failed request is not a finished step.
  const canPay = payments.data
    ? payments.data.pro && payments.data.available
    : true;
  const steps = [
    {
      title: "Задайте рабочие часы",
      done: hasHours,
      href: setupStepHref(practice.id, "hours"),
    },
    {
      title: "Укажите цены",
      done: (offer.data?.packages.length ?? 0) > 0,
      shown: canPay,
      href: setupStepHref(practice.id, "prices"),
    },
    {
      title: "Добавьте фото на страницу записи",
      done: !!practice.imageUrl,
      href: paths.booking.page(practice.id),
    },
    {
      title: "Подключите онлайн-оплату",
      done: !!payments.data?.account,
      shown: canPay,
      href: paths.booking.onlinePayment(practice.id),
    },
    {
      title: "Отправьте ссылку первому клиенту",
      done: hasClients,
      href: setupStepHref(practice.id, "link"),
    },
  ].filter((s) => s.shown !== false);
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const next = steps.find((s) => !s.done);
  // Back into the first setup while it has something left to do.
  const resume =
    steps.find((s) => !s.done && s.href.includes("/setup?")) ?? next;

  return (
    <Frame spacing="default">
      <FramePanel className="flex flex-col gap-4">
        <FrameHeader className="flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 p-0">
          <div className="flex flex-col gap-0.5">
            <FrameTitle>Настройка практики</FrameTitle>
            <FrameDescription>
              Готово {done} из {steps.length}
            </FrameDescription>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Progress
              value={(done / steps.length) * 100}
              aria-label={`Настройка: готово ${done} из ${steps.length}`}
              className="w-32 [&_[data-slot=progress-indicator]]:bg-brand"
            />
            {resume && (
              <Button
                size="sm"
                nativeButton={false}
                render={<Link href={resume.href as Route} />}
              >
                Продолжить настройку
                <ArrowRightIcon />
              </Button>
            )}
          </div>
        </FrameHeader>
        <ol className="grid gap-1 sm:grid-cols-2">
          {steps.map((step) => (
            <li key={step.title}>
              <Link
                href={step.href as Route}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-md px-2 text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:bg-muted/50",
                  step === next && "font-medium",
                  step.done && "text-muted-foreground",
                )}
              >
                {step.done ? (
                  <CircleCheckIcon
                    className="size-4 shrink-0 text-brand"
                    aria-label="Готово"
                  />
                ) : (
                  <CircleDashedIcon
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-label="Не сделано"
                  />
                )}
                {step.title}
              </Link>
            </li>
          ))}
        </ol>
      </FramePanel>
    </Frame>
  );
}

/** The booking link, where the day's work is. */
function BookingLink({ practice }: { practice: PracticeSummary }) {
  return (
    <Frame spacing="default">
      <FramePanel className="flex flex-col gap-3">
        <FrameHeader className="p-0">
          <FrameTitle>Страница записи</FrameTitle>
          <FrameDescription>
            Клиенты записываются по ссылке без регистрации
          </FrameDescription>
        </FrameHeader>
        <BookingLinkActions url={practice.bookingUrl} />
      </FramePanel>
    </Frame>
  );
}
