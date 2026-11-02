"use client";

import { isDefinedError } from "@orpc/client";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@synoro/ui";
import {
  capitalize,
  formatCredits,
  freeBookingFormSchema,
} from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarCheckIcon,
  CheckIcon,
  LockIcon,
  SearchIcon,
  UserRoundCheckIcon,
  UserRoundPlusIcon,
} from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { matchClients, phoneDigits } from "./client-search";
import {
  type Repeat,
  RepeatSelect,
  SeriesDateList,
  seriesChoice,
  useSeriesPreview,
} from "./series-fields";
import { ErrorState } from "./states";
import { useTerms } from "./terms";
import { dateKey } from "./time";
import { TimeSelect } from "./time-select";

type EntryMode = "consultation" | "free" | "block";

export interface EntryDraft {
  mode: EntryMode;
  start: Date;
  end: Date;
}

const minutesOf = (at: Date) => at.getHours() * 60 + at.getMinutes();

function atMinute(date: string, minute: number) {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 0, minute);
}

/**
 * Staff-only "new entry": a paid one-hour booking of a practice client
 * from their balance, a free 30-minute booking for a guest, or a block of
 * the specialist's own time. Opened from a calendar selection or
 * the toolbar; date and times stay editable.
 */
export function EntryDialog({
  practiceId,
  draft,
  onClose,
}: {
  practiceId: string;
  draft: EntryDraft | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {draft && (
          <EntryForm practiceId={practiceId} draft={draft} onDone={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EntryForm({
  practiceId,
  draft,
  onDone,
}: {
  practiceId: string;
  draft: EntryDraft;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const terms = useTerms();
  const [mode, setMode] = useState<EntryMode>(draft.mode);
  const [date, setDate] = useState(dateKey(draft.start));
  const [start, setStart] = useState(minutesOf(draft.start));
  const [end, setEnd] = useState(
    Math.max(minutesOf(draft.end) || 1440, minutesOf(draft.start) + 30),
  );
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestContact, setGuestContact] = useState("");
  const [note, setNote] = useState("");
  const [memberId, setMemberId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [repeat, setRepeat] = useState<Repeat | null>(null);
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());
  const members = useQuery({
    ...orpc.practice.members.queryOptions({ input: { practiceId } }),
    // The intro form recognises a caller who is already a client.
    enabled: mode !== "block",
  });
  const clients = (members.data ?? []).filter((m) => m.role === "client");
  const client = clients.find((c) => c.id === memberId);
  const found = matchClients(clients, search);
  const guestDigits = phoneDigits(guestPhone);
  const knownCaller =
    mode === "free" && guestDigits.length >= 11
      ? clients.find((c) => c.phone && phoneDigits(c.phone) === guestDigits)
      : undefined;
  const series = mode === "consultation" && client ? repeat : null;
  const preview = useSeriesPreview({
    practiceId,
    startsAt: series ? atMinute(date, start) : null,
    repeat: series,
    memberId: client?.id,
  });
  const { chosen, skip } = seriesChoice(preview.data?.dates ?? [], unchecked);

  const onSuccess = async (message: string) => {
    toast.success(message);
    await queryClient.invalidateQueries({ queryKey: orpc.booking.key() });
    onDone();
  };
  const bookFree = useMutation({
    ...orpc.booking.bookFree.mutationOptions(),
    onSuccess: () => onSuccess(`${terms.free}: гость записан`),
    onError: (error) => toast.error(error.message),
  });
  const book = useMutation({
    ...orpc.booking.book.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
      await onSuccess(`${capitalize(terms.credit[0])}: клиент записан`);
    },
    onError: (error) =>
      toast.error(
        isDefinedError(error) && error.code === "NO_CREDITS"
          ? "У клиента пустой баланс — начислите оплату на странице клиентов"
          : error.message,
      ),
  });
  const bookSeries = useMutation({
    ...orpc.booking.bookSeries.mutationOptions(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
      await onSuccess(
        `Клиент записан: ${formatCredits(result.dates.length, terms)}`,
      );
    },
    onError: async (error) => {
      toast.error(
        isDefinedError(error) && error.code === "NO_CREDITS"
          ? "На балансе клиента не хватает оплаты на все даты"
          : error.message,
      );
      await preview.refetch();
    },
  });
  const block = useMutation({
    ...orpc.booking.block.mutationOptions(),
    onSuccess: () => onSuccess("Время закрыто"),
    onError: (error) => toast.error(error.message),
  });
  const pending =
    book.isPending ||
    bookSeries.isPending ||
    bookFree.isPending ||
    block.isPending;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "consultation") {
      if (!memberId) {
        toast.error("Выберите клиента");
        return;
      }
      if (series) {
        bookSeries.mutate({
          practiceId,
          memberId,
          startsAt: atMinute(date, start),
          ...series,
          skip,
          note: note || undefined,
        });
        return;
      }
      book.mutate({
        practiceId,
        memberId,
        startsAt: atMinute(date, start),
        note: note || undefined,
      });
      return;
    }
    if (mode === "free") {
      const parsed = freeBookingFormSchema.safeParse({
        guestName,
        guestPhone,
        guestContact: guestContact || undefined,
        note: note || undefined,
      });
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? "Проверьте данные");
        return;
      }
      bookFree.mutate({
        practiceId,
        startsAt: atMinute(date, start),
        ...parsed.data,
      });
      return;
    }
    if (end <= start) {
      toast.error("Конец должен быть позже начала");
      return;
    }
    block.mutate({
      practiceId,
      startsAt: atMinute(date, start),
      endsAt: atMinute(date, end),
      note: note || undefined,
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Новая запись</DialogTitle>
        <DialogDescription>
          {capitalize(terms.credit[0])} на час с баланса клиента,{" "}
          {terms.free.toLowerCase()} на 30 минут для гостя или закрытое время.
        </DialogDescription>
      </DialogHeader>

      <Tabs value={mode} onValueChange={(value) => setMode(value as EntryMode)}>
        <TabsList className="w-full">
          <TabsTrigger value="consultation">
            <CalendarCheckIcon />
            Клиент
          </TabsTrigger>
          <TabsTrigger value="free">
            <UserRoundPlusIcon />
            {terms.free}
          </TabsTrigger>
          <TabsTrigger value="block">
            <LockIcon />
            Закрыть время
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entry-date">Дата</Label>
          <Input
            id="entry-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>{mode === "block" ? "С" : "Начало"}</Label>
          <TimeSelect label="Начало" value={start} onChange={setStart} />
        </div>
        {mode === "block" && (
          <div className="flex flex-col gap-1.5">
            <Label>До</Label>
            <TimeSelect label="Конец" value={end} onChange={setEnd} endOfDay />
          </div>
        )}
      </div>

      {mode === "consultation" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entry-client">Клиент</Label>
          {members.isError ? (
            <ErrorState
              message="Не удалось загрузить список клиентов."
              onRetry={() => members.refetch()}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="entry-client"
                  autoFocus
                  autoComplete="off"
                  placeholder={
                    members.isPending ? "Загрузка…" : "Имя или телефон клиента"
                  }
                  className="pl-8"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    // A new search may hide the chosen client: never book
                    // someone no longer on screen.
                    setMemberId(null);
                    setRepeat(null);
                  }}
                />
              </div>
              <div className="flex max-h-48 flex-col overflow-y-auto rounded-md border">
                {found.slice(0, 50).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={c.id === memberId}
                    onClick={() => setMemberId(c.id)}
                    className={cn(
                      "flex items-center gap-2 border-b px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-muted/60",
                      c.id === memberId && "bg-primary/5 dark:bg-primary/10",
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{c.name}</span>
                      <span className="truncate text-xs text-muted-foreground tabular-nums">
                        {c.phone ?? c.email}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-xs tabular-nums",
                        c.credits > 0
                          ? "text-muted-foreground"
                          : "text-destructive",
                      )}
                    >
                      {formatCredits(c.credits, terms)}
                    </span>
                    {c.id === memberId && (
                      <CheckIcon className="size-4 shrink-0 text-primary" />
                    )}
                  </button>
                ))}
                {members.isSuccess && found.length === 0 && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    {clients.length === 0
                      ? "В практике пока нет клиентов."
                      : "Никого не нашли."}{" "}
                    <button
                      type="button"
                      className="text-primary underline-offset-4 hover:underline"
                      onClick={() => {
                        setMode("free");
                        if (/\d{3}/.test(search)) setGuestPhone(search);
                        else if (search.trim()) setGuestName(search.trim());
                      }}
                    >
                      Записать как нового: {terms.free.toLowerCase()}
                    </button>
                  </p>
                )}
              </div>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {client && client.credits === 0
              ? `У ${client.name} нет оплаченных — начислите оплату на странице клиентов.`
              : `Спишется ${formatCredits(1, terms)} с баланса клиента за каждую дату, только целые часы в рабочее время.`}
          </p>
          {client && (
            <RepeatSelect
              value={repeat}
              onChange={(next) => {
                setRepeat(next);
                setUnchecked(new Set());
              }}
              max={client.credits}
              idPrefix="entry"
            />
          )}
          {series && (
            <SeriesDateList
              query={preview}
              unchecked={unchecked}
              idPrefix="entry"
              onToggle={(at, checked) => {
                const next = new Set(unchecked);
                if (checked) next.delete(at.getTime());
                else next.add(at.getTime());
                setUnchecked(next);
              }}
            />
          )}
        </div>
      )}

      {mode === "free" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="entry-guest">Имя гостя</Label>
            <Input
              id="entry-guest"
              autoFocus
              required
              placeholder="Иван Петров"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="entry-phone">Телефон</Label>
            <Input
              id="entry-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              placeholder="+7 900 000-00-00"
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
            />
          </div>
          {knownCaller && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-info/30 bg-info/4 px-3 py-2 text-sm sm:col-span-2">
              <UserRoundCheckIcon className="size-4 shrink-0 text-info" />
              <span className="min-w-0 flex-1">
                Это клиент {knownCaller.name},{" "}
                {formatCredits(knownCaller.credits, terms)} на балансе
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  // Search by their phone: the list shows them, chosen,
                  // whatever was searched for before.
                  setSearch(knownCaller.phone ?? knownCaller.name);
                  setMemberId(knownCaller.id);
                  setRepeat(null);
                  setMode("consultation");
                }}
              >
                Записать как клиента
              </Button>
            </div>
          )}
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="entry-contact">Почта или Telegram</Label>
            <Input
              id="entry-contact"
              placeholder="По желанию"
              value={guestContact}
              onChange={(e) => setGuestContact(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="entry-note">Заметка</Label>
        <Textarea
          id="entry-note"
          rows={2}
          placeholder={mode === "block" ? "Личное время" : "Запрос клиента"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Отмена
        </Button>
        <Button
          type="submit"
          disabled={pending || (series !== null && chosen.length < 2)}
        >
          {mode === "block"
            ? "Закрыть время"
            : series
              ? `Записать: ${formatCredits(chosen.length, terms)}`
              : "Записать"}
        </Button>
      </DialogFooter>
    </form>
  );
}
