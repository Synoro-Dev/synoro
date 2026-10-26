"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  toast,
} from "@acme/ui";
import { freeConsultationFormSchema } from "@acme/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { ConfirmButton } from "./confirm-button";
import { dateKey, formatDayHeading, formatTime, groupIntoDays } from "./time";
import { TimeSelect } from "./time-select";
import { WEEK_DAYS, WeekNav } from "./week-nav";

const KIND_LABELS = {
  consultation: "Консультация",
  free: "Бесплатная",
  blocked: "Закрыто",
} as const;

type Item =
  | {
      type: "booking";
      id: string;
      kind: keyof typeof KIND_LABELS;
      startsAt: Date;
      endsAt: Date;
      title: string;
      detail: string | null;
    }
  | { type: "free-slot"; startsAt: Date; endsAt: Date };

/** Local wall-clock `date` + `minute` in the viewer's zone (24:00 ok). */
function localInstant(date: string, minute: number) {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 0, minute);
}

/**
 * The specialist's week: every booking, free consultation and block, plus
 * open half-hour slots where staff can book a free consultation for a guest.
 */
export function StaffCalendar({
  practiceId,
  timezone,
}: {
  practiceId: string;
  timezone: string;
}) {
  const queryClient = useQueryClient();
  const today = dateKey(new Date(), timezone);
  const [from, setFrom] = useState(today);

  const calendar = useQuery(
    orpc.booking.calendar.queryOptions({
      input: { practiceId, from, days: WEEK_DAYS },
    }),
  );
  const freeSlots = useQuery(
    orpc.booking.slots.queryOptions({
      input: { practiceId, from, days: WEEK_DAYS, kind: "free" },
    }),
  );

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.booking.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.practice.key() }),
    ]);

  const cancel = useMutation({
    ...orpc.booking.cancel.mutationOptions(),
    onSuccess: async (result) => {
      toast.success(
        result.kind === "blocked"
          ? "Время снова открыто для записи"
          : result.refunded
            ? "Отменено, консультация возвращена клиенту"
            : "Отменено",
      );
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const items: Item[] = [
    ...(calendar.data ?? []).map(
      (b): Item => ({
        type: "booking",
        id: b.id,
        kind: b.kind,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        title:
          b.kind === "consultation"
            ? (b.clientName ?? "Клиент удалён")
            : b.kind === "free"
              ? (b.guestName ?? "Гость")
              : (b.note ?? "Личное время"),
        detail:
          b.kind === "consultation"
            ? b.clientEmail
            : b.kind === "free"
              ? b.guestContact
              : null,
      }),
    ),
    ...(freeSlots.data?.slots ?? []).map(
      (s): Item => ({ type: "free-slot", ...s }),
    ),
  ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  return (
    <div className="flex flex-col gap-6">
      <BlockTimeForm practiceId={practiceId} today={today} onDone={refresh} />
      <WeekNav from={from} minFrom={today} onChange={setFrom} />
      <p className="text-xs text-muted-foreground">
        Свободные получасовые окна — нажмите, чтобы записать гостя на бесплатную
        консультацию.
      </p>

      {calendar.isPending || freeSlots.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {groupIntoDays(items, from, WEEK_DAYS).map(([day, dayItems]) => (
            <div key={day} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium first-letter:uppercase">
                {formatDayHeading(day)}
              </h3>
              {dayItems.length === 0 && (
                <p className="text-xs text-muted-foreground">Нет приёма</p>
              )}
              {dayItems.map((item) =>
                item.type === "free-slot" ? (
                  <FreeSlotButton
                    key={`free-${item.startsAt.toISOString()}`}
                    practiceId={practiceId}
                    startsAt={item.startsAt}
                    onDone={refresh}
                  />
                ) : (
                  <div
                    key={item.id}
                    className="flex flex-col gap-1 rounded-md border p-2 text-sm data-[kind=blocked]:bg-muted data-[kind=consultation]:border-primary"
                    data-kind={item.kind}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-medium tabular-nums">
                        {formatTime(item.startsAt)}–{formatTime(item.endsAt)}
                      </span>
                      <Badge
                        variant={
                          item.kind === "consultation" ? "default" : "outline"
                        }
                      >
                        {KIND_LABELS[item.kind]}
                      </Badge>
                    </div>
                    <span className="truncate">{item.title}</span>
                    {item.detail && (
                      <span className="truncate text-xs text-muted-foreground">
                        {item.detail}
                      </span>
                    )}
                    <div className="flex flex-wrap gap-1">
                      <ConfirmButton
                        size="xs"
                        title={
                          item.kind === "blocked"
                            ? "Открыть время?"
                            : "Отменить запись?"
                        }
                        description={
                          item.kind === "consultation"
                            ? "Консультация вернётся клиенту на баланс."
                            : "Время снова станет свободным."
                        }
                        confirmLabel={
                          item.kind === "blocked" ? "Открыть" : "Отменить"
                        }
                        disabled={cancel.isPending}
                        onConfirm={() => cancel.mutate({ bookingId: item.id })}
                      >
                        {item.kind === "blocked" ? "Открыть" : "Отменить"}
                      </ConfirmButton>
                      {item.kind === "consultation" && (
                        <ConfirmButton
                          size="xs"
                          variant="ghost"
                          title="Отменить без возврата?"
                          description="Например, клиент не пришёл: консультация останется списанной."
                          confirmLabel="Отменить без возврата"
                          disabled={cancel.isPending}
                          onConfirm={() =>
                            cancel.mutate({ bookingId: item.id, refund: false })
                          }
                        >
                          Без возврата
                        </ConfirmButton>
                      )}
                    </div>
                  </div>
                ),
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FreeSlotButton({
  practiceId,
  startsAt,
  onDone,
}: {
  practiceId: string;
  startsAt: Date;
  onDone: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestContact, setGuestContact] = useState("");

  const bookFree = useMutation({
    ...orpc.booking.bookFree.mutationOptions(),
    onSuccess: async () => {
      toast.success("Бесплатная консультация записана");
      setOpen(false);
      await onDone();
    },
    onError: async (error) => {
      toast.error(error.message);
      await onDone();
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = freeConsultationFormSchema.safeParse({
      guestName,
      guestContact: guestContact || undefined,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Проверьте данные");
      return;
    }
    bookFree.mutate({ practiceId, startsAt, ...parsed.data });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="xs"
            variant="ghost"
            className="justify-start border border-dashed text-muted-foreground"
          />
        }
      >
        {formatTime(startsAt)} свободно
      </PopoverTrigger>
      <PopoverContent>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <p className="font-medium">
            Бесплатная консультация, {formatTime(startsAt)} (30 мин)
          </p>
          <div className="space-y-1">
            <Label htmlFor={`guest-${startsAt.getTime()}`}>Имя</Label>
            <Input
              id={`guest-${startsAt.getTime()}`}
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`contact-${startsAt.getTime()}`}>
              Телефон или почта
            </Label>
            <Input
              id={`contact-${startsAt.getTime()}`}
              value={guestContact}
              onChange={(e) => setGuestContact(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={bookFree.isPending}>
            Записать
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Close any half-hour aligned range for clients (the specialist's time). */
function BlockTimeForm({
  practiceId,
  today,
  onDone,
}: {
  practiceId: string;
  today: string;
  onDone: () => Promise<unknown>;
}) {
  const [date, setDate] = useState(today);
  const [start, setStart] = useState(600);
  const [end, setEnd] = useState(660);
  const [note, setNote] = useState("");

  const block = useMutation({
    ...orpc.booking.block.mutationOptions(),
    onSuccess: async () => {
      toast.success("Время закрыто для записи");
      setNote("");
      await onDone();
    },
    onError: (error) => toast.error(error.message),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (end <= start) {
      toast.error("Конец должен быть позже начала");
      return;
    }
    block.mutate({
      practiceId,
      startsAt: localInstant(date, start),
      endsAt: localInstant(date, end),
      note: note || undefined,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Закрыть время</CardTitle>
        <CardDescription>
          Забронировать время для себя — клиенты не смогут на него записаться.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="block-date">Дата</Label>
            <Input
              id="block-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <TimeSelect
            label="С"
            value={start}
            min={0}
            max={1410}
            onChange={setStart}
          />
          <span className="pb-2">—</span>
          <TimeSelect
            label="До"
            value={end}
            min={30}
            max={1440}
            onChange={setEnd}
          />
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="block-note">Заметка</Label>
            <Input
              id="block-note"
              placeholder="Личное время"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={block.isPending}>
            Закрыть
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
