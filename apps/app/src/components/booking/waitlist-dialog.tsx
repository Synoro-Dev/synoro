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
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  toast,
} from "@synoro/ui";
import {
  formatMinutes,
  WAITLIST_MAX_DAYS,
  waitlistJoinSchema,
} from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRingIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { dateKey, viewerTimeZoneName } from "./time";

/** Hours of the day a wish may be limited to, in the practice's own time. */
const PARTS = {
  any: { label: "Любое время", fromMinute: null, toMinute: null },
  morning: { label: "Утро, до 12:00", fromMinute: null, toMinute: 720 },
  day: { label: "День, 12:00–18:00", fromMinute: 720, toMinute: 1080 },
  evening: { label: "Вечер, после 18:00", fromMinute: 1080, toMinute: null },
} as const;

type Part = keyof typeof PARTS;

const PART_ITEMS = Object.fromEntries(
  Object.entries(PARTS).map(([key, part]) => [key, part.label]),
);

/** YYYY-MM-DD plus `days` on the calendar (no time zone involved). */
function addDays(key: string, days: number) {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** «9 ноября» for a YYYY-MM-DD key. */
function dayText(key: string) {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("ru-RU", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
  });
}

interface WaitlistService {
  id: string;
  name: string;
  minutes: number;
}

/**
 * «Нет подходящего времени?» under the booking panel: a wish for dates, hours
 * and a service. When matching time frees up the person is told once and books
 * it on this page — nothing is held for them. A signed-in client also sees
 * their open wishes here and can drop them.
 */
export function WaitlistRow({
  practiceId,
  timezone,
  services,
  serviceId,
  signedIn,
  viewerZone,
}: {
  practiceId: string;
  /** The practice's zone: the wish's days and hours are its own. */
  timezone: string;
  services: WaitlistService[];
  /** The service the page is showing now; the wish starts with it. */
  serviceId?: string;
  signedIn: boolean;
  /** The zone the visitor reads times in. */
  viewerZone: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const mine = useQuery({
    ...orpc.waitlist.mine.queryOptions({ input: { practiceId } }),
    enabled: signedIn,
  });
  const leave = useMutation({
    ...orpc.waitlist.leave.mutationOptions(),
    onSuccess: async () => {
      toast.success("Вы вышли из листа ожидания");
      await queryClient.invalidateQueries({ queryKey: orpc.waitlist.key() });
    },
    onError: (error) => toast.error(error.message),
  });
  const entries = mine.data?.entries ?? [];

  return (
    <div className="flex flex-col gap-3 border-t px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-sm text-muted-foreground">
          Нет подходящего времени? Оставьте пожелание — напишем, когда оно
          освободится.
        </p>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <BellRingIcon />
          Лист ожидания
        </Button>
      </div>

      {entries.length > 0 && (
        <ul className="flex flex-col gap-1.5 text-sm">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2"
            >
              <span>
                Вы ждёте: {dayText(entry.fromDate)}
                {entry.toDate !== entry.fromDate &&
                  ` — ${dayText(entry.toDate)}`}
                {entry.service && `, ${entry.service}`}
              </span>
              <Button
                variant="ghost"
                size="xs"
                disabled={leave.isPending}
                onClick={() => leave.mutate({ entryId: entry.id })}
              >
                Выйти
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
          {open && (
            <WaitlistForm
              practiceId={practiceId}
              timezone={timezone}
              services={services}
              serviceId={serviceId}
              signedIn={signedIn}
              viewerZone={viewerZone}
              onDone={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WaitlistForm({
  practiceId,
  timezone,
  services,
  serviceId,
  signedIn,
  viewerZone,
  onDone,
}: {
  practiceId: string;
  timezone: string;
  services: WaitlistService[];
  serviceId?: string;
  signedIn: boolean;
  viewerZone: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const today = dateKey(new Date(), timezone);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(addDays(today, 13));
  const [part, setPart] = useState<Part>("any");
  const [chosenService, setChosenService] = useState(serviceId ?? "");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const me = useQuery({
    ...orpc.user.me.queryOptions(),
    enabled: signedIn,
  });
  const needsPhone = !signedIn || !me.data?.phone;

  const join = useMutation({
    ...orpc.waitlist.join.mutationOptions(),
    onSuccess: async () => {
      toast.success(
        signedIn
          ? "Вы в листе ожидания"
          : "Вы в листе ожидания — напишем на почту, когда время освободится",
      );
      await queryClient.invalidateQueries({ queryKey: orpc.waitlist.key() });
      onDone();
    },
    onError: (e) => {
      if (isDefinedError(e) && e.code === "SIGN_IN_REQUIRED") {
        setError(e.message);
        return;
      }
      toast.error(e.message);
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const wished = PARTS[part];
    const parsed = waitlistJoinSchema.safeParse({
      fromDate,
      toDate,
      fromMinute: wished.fromMinute,
      toMinute: wished.toMinute,
      serviceId: chosenService || undefined,
      // A signed-in client's account speaks for them; the server ignores these.
      name: signedIn ? (me.data?.name ?? "Клиент") : name,
      email: signedIn ? (me.data?.email ?? "") : email,
      phone: signedIn ? (me.data?.phone ?? phone) : phone,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Проверьте данные");
      return;
    }
    setError(undefined);
    join.mutate({ practiceId, ...parsed.data });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Лист ожидания</DialogTitle>
        <DialogDescription>
          Когда у специалиста освободится подходящее время, мы один раз вам
          напишем. Время ни за кем не закрепляется: записывается тот, кто успел
          первым. Выбрать можно до {WAITLIST_MAX_DAYS} дней.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="waitlist-from">С</Label>
          <Input
            id="waitlist-from"
            type="date"
            min={today}
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              if (toDate < e.target.value) setToDate(e.target.value);
              setError(undefined);
            }}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="waitlist-to">По</Label>
          <Input
            id="waitlist-to"
            type="date"
            min={fromDate}
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setError(undefined);
            }}
            className="w-40"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="waitlist-part">Когда удобно</Label>
        <Select
          items={PART_ITEMS}
          value={part}
          onValueChange={(value) => setPart(value as Part)}
        >
          <SelectTrigger id="waitlist-part">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PARTS).map(([key, item]) => (
              <SelectItem key={key} value={key}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {viewerZone !== timezone && (
          <p className="text-xs text-muted-foreground">
            Часы — по времени специалиста ({viewerTimeZoneName(timezone)}).
          </p>
        )}
      </div>

      {services.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="waitlist-service">Услуга</Label>
          <Select
            items={Object.fromEntries(services.map((s) => [s.id, s.name]))}
            value={chosenService || services[0]?.id || ""}
            onValueChange={(id) => setChosenService(String(id))}
          >
            <SelectTrigger id="waitlist-service">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {services.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} · {formatMinutes(s.minutes, true)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {!signedIn && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="waitlist-name">Имя</Label>
            <Input
              id="waitlist-name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="waitlist-email">Почта</Label>
            <Input
              id="waitlist-email"
              type="email"
              autoComplete="email"
              placeholder="Сюда придёт письмо"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </>
      )}
      {needsPhone && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="waitlist-phone">Телефон</Label>
          <Input
            id="waitlist-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+7 900 123-45-67"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Отмена
        </Button>
        <Button type="submit" disabled={join.isPending}>
          {join.isPending && <Spinner />}
          Встать в лист
        </Button>
      </DialogFooter>
    </form>
  );
}
