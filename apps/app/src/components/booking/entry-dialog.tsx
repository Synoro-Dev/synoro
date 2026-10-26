"use client";

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
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "@synoro/ui";
import { freeConsultationFormSchema } from "@synoro/validators";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LockIcon, UserRoundPlusIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { dateKey } from "./time";
import { TimeSelect } from "./time-select";

type EntryMode = "free" | "block";

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
 * Staff-only "new entry": a free 30-minute consultation for a guest, or a
 * block of the specialist's own time. Opened from a calendar selection or
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
  const [mode, setMode] = useState<EntryMode>(draft.mode);
  const [date, setDate] = useState(dateKey(draft.start));
  const [start, setStart] = useState(minutesOf(draft.start));
  const [end, setEnd] = useState(
    Math.max(minutesOf(draft.end) || 1440, minutesOf(draft.start) + 30),
  );
  const [guestName, setGuestName] = useState("");
  const [guestContact, setGuestContact] = useState("");
  const [note, setNote] = useState("");

  const onSuccess = async (message: string) => {
    toast.success(message);
    await queryClient.invalidateQueries({ queryKey: orpc.booking.key() });
    onDone();
  };
  const bookFree = useMutation({
    ...orpc.booking.bookFree.mutationOptions(),
    onSuccess: () => onSuccess("Консультация записана"),
    onError: (error) => toast.error(error.message),
  });
  const block = useMutation({
    ...orpc.booking.block.mutationOptions(),
    onSuccess: () => onSuccess("Время закрыто"),
    onError: (error) => toast.error(error.message),
  });
  const pending = bookFree.isPending || block.isPending;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "free") {
      const parsed = freeConsultationFormSchema.safeParse({
        guestName,
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
          Бесплатная консультация на 30 минут или личное время.
        </DialogDescription>
      </DialogHeader>

      <Tabs value={mode} onValueChange={(value) => setMode(value as EntryMode)}>
        <TabsList className="w-full">
          <TabsTrigger value="free">
            <UserRoundPlusIcon />
            Консультация
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
          <Label>{mode === "free" ? "Начало" : "С"}</Label>
          <TimeSelect label="Начало" value={start} onChange={setStart} />
        </div>
        {mode === "block" && (
          <div className="flex flex-col gap-1.5">
            <Label>До</Label>
            <TimeSelect label="Конец" value={end} onChange={setEnd} endOfDay />
          </div>
        )}
      </div>

      {mode === "free" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="entry-guest">Имя гостя</Label>
            <Input
              id="entry-guest"
              autoFocus
              placeholder="Иван Петров"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="entry-contact">Телефон или почта</Label>
            <Input
              id="entry-contact"
              placeholder="+7 900 000-00-00"
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
          placeholder={mode === "free" ? "Запрос клиента" : "Личное время"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Отмена
        </Button>
        <Button type="submit" disabled={pending}>
          {mode === "free" ? "Записать" : "Закрыть время"}
        </Button>
      </DialogFooter>
    </form>
  );
}
