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
import { CalendarCheckIcon, LockIcon, UserRoundPlusIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
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
  const members = useQuery({
    ...orpc.practice.members.queryOptions({ input: { practiceId } }),
    enabled: mode === "consultation",
  });
  const clients = (members.data ?? []).filter((m) => m.role === "client");
  const clientLabels = Object.fromEntries(
    clients.map((c) => [
      c.id,
      `${c.name} · ${formatCredits(c.credits, terms)}`,
    ]),
  );

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
  const block = useMutation({
    ...orpc.booking.block.mutationOptions(),
    onSuccess: () => onSuccess("Время закрыто"),
    onError: (error) => toast.error(error.message),
  });
  const pending = book.isPending || bookFree.isPending || block.isPending;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "consultation") {
      if (!memberId) {
        toast.error("Выберите клиента");
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
          <Select
            items={clientLabels}
            value={memberId}
            onValueChange={(value) => setMemberId(value as string | null)}
          >
            <SelectTrigger id="entry-client" className="w-full">
              <SelectValue
                placeholder={
                  members.isPending ? "Загрузка…" : "Выберите клиента"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {clientLabels[c.id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            {members.isSuccess && clients.length === 0
              ? "В практике пока нет клиентов — пригласите их на странице клиентов."
              : `Спишется ${formatCredits(1, terms)} с баланса клиента, только целые часы в рабочее время.`}
          </p>
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
        <Button type="submit" disabled={pending}>
          {mode === "block" ? "Закрыть время" : "Записать"}
        </Button>
      </DialogFooter>
    </form>
  );
}
