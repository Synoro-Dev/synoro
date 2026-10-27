"use client";

import { paths } from "@synoro/config";
import { Button, Input, Skeleton, toast } from "@synoro/ui";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import { Badge } from "@synoro/ui/reui/badge";
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import { IconTile } from "@synoro/ui/reui/icon-tile";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDaysIcon,
  CalendarPlusIcon,
  Clock3Icon,
  CopyIcon,
  ExternalLinkIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import {
  BookingDialog,
  bookingTitle,
  type CalendarBooking,
  KIND_META,
} from "./booking-dialog";
import { EntryDialog, type EntryDraft } from "./entry-dialog";
import { EmptyState, ErrorState } from "./states";
import { dateKey, formatTime } from "./time";

const WEEK = 7;

function Kpi({
  label,
  value,
  hint,
  loading,
}: {
  label: string;
  value: number | string;
  hint: string;
  loading: boolean;
}) {
  return (
    <FramePanel className="flex flex-col gap-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      {loading ? (
        <Skeleton className="h-8 w-16" />
      ) : (
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </span>
      )}
      <span className="text-xs text-muted-foreground">{hint}</span>
    </FramePanel>
  );
}

function DateChip({ at }: { at: Date }) {
  return (
    <div className="flex w-11 shrink-0 flex-col items-center rounded-md border py-1 leading-none">
      <span className="text-[0.625rem] font-medium text-muted-foreground uppercase">
        {at.toLocaleDateString("ru-RU", { weekday: "short" })}
      </span>
      <span className="text-base font-semibold tabular-nums">
        {at.getDate()}
      </span>
    </div>
  );
}

export function PracticeOverview({
  practice,
}: {
  practice: { id: string; slug: string; timezone: string };
}) {
  const from = dateKey(new Date(), practice.timezone);
  const [draft, setDraft] = useState<EntryDraft | null>(null);
  const [selected, setSelected] = useState<CalendarBooking | null>(null);

  const calendar = useQuery(
    orpc.booking.calendar.queryOptions({
      input: { practiceId: practice.id, from, days: WEEK },
    }),
  );
  const slots = useQuery(
    orpc.booking.slots.queryOptions({
      input: { practiceId: practice.id, from, days: WEEK },
    }),
  );
  const members = useQuery(
    orpc.practice.members.queryOptions({ input: { practiceId: practice.id } }),
  );
  const rules = useQuery(
    orpc.availability.list.queryOptions({ input: { practiceId: practice.id } }),
  );

  const now = Date.now();
  const appointments = (calendar.data ?? []).filter(
    (b) => b.kind !== "blocked",
  );
  const upcoming = (calendar.data ?? [])
    .filter((b) => b.endsAt.getTime() > now)
    .slice(0, 8);
  const today = appointments.filter(
    (b) => dateKey(b.startsAt) === dateKey(new Date()),
  );
  const clients = (members.data ?? []).filter((m) => m.role === "client");
  const prepaid = clients.reduce((sum, m) => sum + m.credits, 0);
  const publicPath = paths.booking.public(practice.slug);

  async function copyLink() {
    const url = new URL(publicPath, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Ссылка скопирована");
    } catch {
      toast.info(url);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {rules.data?.length === 0 && (
        <Alert variant="warning">
          <Clock3Icon />
          <AlertTitle>Часы приёма не заданы</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>Клиенты не увидят свободного времени для записи.</span>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link href={paths.booking.schedule(practice.id)} />}
            >
              Задать расписание
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Frame
        spacing="default"
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
      >
        <Kpi
          label="Сегодня"
          value={today.length}
          hint="записей на сегодня"
          loading={calendar.isPending}
        />
        <Kpi
          label="Неделя"
          value={appointments.length}
          hint="записей за 7 дней"
          loading={calendar.isPending}
        />
        <Kpi
          label="Свободно"
          value={slots.data?.slots.length ?? 0}
          hint="часов для записи за 7 дней"
          loading={slots.isPending}
        />
        <Kpi
          label="Клиенты"
          value={clients.length}
          hint={`оплачено консультаций: ${prepaid}`}
          loading={members.isPending}
        />
      </Frame>

      <div className="grid min-w-0 gap-6 lg:grid-cols-3">
        <Frame spacing="default" className="min-w-0 lg:col-span-2">
          <FramePanel className="flex flex-col gap-3">
            <FrameHeader className="flex-row items-center justify-between p-0">
              <div className="flex flex-col gap-0.5">
                <FrameTitle>Ближайшие записи</FrameTitle>
                <FrameDescription>Следующие 7 дней</FrameDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link href={paths.booking.calendar(practice.id)} />}
              >
                <CalendarDaysIcon />
                Календарь
              </Button>
            </FrameHeader>

            {calendar.isError ? (
              <ErrorState onRetry={() => calendar.refetch()} />
            ) : calendar.isPending ? (
              <div className="flex flex-col gap-2">
                {["a", "b", "c"].map((k) => (
                  <Skeleton key={k} className="h-14 w-full" />
                ))}
              </div>
            ) : upcoming.length === 0 ? (
              <EmptyState
                icon={CalendarDaysIcon}
                title="Записей нет"
                description="Поделитесь ссылкой — клиенты запишутся сами."
                action={
                  <Button size="sm" onClick={copyLink}>
                    <CopyIcon />
                    Скопировать ссылку
                  </Button>
                }
              />
            ) : (
              <ul className="-mx-2 flex flex-col">
                {upcoming.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(b)}
                      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted dark:hover:bg-muted/50"
                    >
                      <DateChip at={b.startsAt} />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">
                          {bookingTitle(b)}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {formatTime(b.startsAt)}–{formatTime(b.endsAt)}
                        </span>
                      </div>
                      <Badge variant={KIND_META[b.kind].badge}>
                        {KIND_META[b.kind].label}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </FramePanel>
        </Frame>

        <Frame spacing="default" className="min-w-0">
          <FramePanel className="flex flex-col gap-4">
            <FrameHeader className="p-0">
              <FrameTitle>Страница записи</FrameTitle>
              <FrameDescription>Отправьте ссылку клиентам</FrameDescription>
            </FrameHeader>
            <div className="flex gap-2">
              <Input
                readOnly
                value={publicPath}
                aria-label="Ссылка для записи"
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="Скопировать ссылку"
                onClick={copyLink}
              >
                <CopyIcon />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Открыть страницу записи"
                nativeButton={false}
                render={<Link href={publicPath} target="_blank" />}
              >
                <ExternalLinkIcon />
              </Button>
            </div>
          </FramePanel>
          <FramePanel className="flex flex-col gap-1">
            <FrameTitle className="mb-2">Быстрые действия</FrameTitle>
            {[
              {
                icon: CalendarPlusIcon,
                label: "Новая запись",
                hint: "Консультация гостя или личное время",
                onClick: () => {
                  const start = new Date();
                  start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0);
                  setDraft({
                    mode: "free",
                    start,
                    end: new Date(start.getTime() + 30 * 60_000),
                  });
                },
              },
            ].map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted dark:hover:bg-muted/50"
              >
                <IconTile size="sm" aria-hidden="true">
                  <action.icon />
                </IconTile>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{action.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {action.hint}
                  </span>
                </div>
              </button>
            ))}
            {[
              {
                icon: WalletIcon,
                label: "Начислить консультации",
                hint: "Оплата от клиента",
                href: paths.booking.clients(practice.id),
              },
              {
                icon: Clock3Icon,
                label: "Часы приёма",
                hint: "Дни и время работы",
                href: paths.booking.schedule(practice.id),
              },
              {
                icon: UsersIcon,
                label: "Пригласить клиента",
                hint: "По адресу почты",
                href: paths.booking.clients(practice.id),
              },
            ].map((action) => (
              <Link
                key={action.label}
                href={action.href}
                className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted dark:hover:bg-muted/50"
              >
                <IconTile size="sm" aria-hidden="true">
                  <action.icon />
                </IconTile>
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{action.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {action.hint}
                  </span>
                </div>
              </Link>
            ))}
          </FramePanel>
          <FrameFooter className="text-xs text-muted-foreground">
            Часовой пояс расписания: {practice.timezone}
          </FrameFooter>
        </Frame>
      </div>

      <EntryDialog
        practiceId={practice.id}
        draft={draft}
        onClose={() => setDraft(null)}
      />
      <BookingDialog booking={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
