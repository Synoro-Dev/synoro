"use client";

import { isDefinedError } from "@orpc/client";
import type { RouterOutputs } from "@synoro/api";
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
  toast,
} from "@synoro/ui";
import {
  CLIENT_NOTE_MAX,
  capitalize,
  clientNoteBodySchema,
} from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LockIcon, NotebookPenIcon, PencilIcon, TrashIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { ConfirmButton } from "./confirm-button";
import { EmptyState, ErrorState } from "./states";
import { useTerms } from "./terms";
import { formatTime } from "./time";

type Note = RouterOutputs["note"]["list"][number];

/** «Без сессии»: Select needs a value for the empty choice. */
const NO_SESSION = "none";

/** «пн, 7 января, 10:00» — how a session is named in the notes. */
function sessionLabel(at: Date) {
  return `${at.toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
  })}, ${formatTime(at)}`;
}

/**
 * The owner's working notes on a client: a composer on top (optionally about
 * one of the client's sessions), the notes below, newest first. Real people's
 * words, so `ph-no-capture`.
 */
export function ClientNotes({
  practiceId,
  memberId,
  sessions,
  bookingId,
  onBookingChange,
}: {
  practiceId: string;
  memberId: string;
  /** The client's sessions a new note can be about, newest first. */
  sessions: { id: string; startsAt: Date }[];
  /** The session picked for a new note; null — about the client. */
  bookingId: string | null;
  onBookingChange: (bookingId: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const notes = useQuery({
    ...orpc.note.list.queryOptions({ input: { practiceId, memberId } }),
    // An expected refusal won't change on a retry.
    retry: (count, error) => !isDefinedError(error) && count < 3,
  });
  const [body, setBody] = useState("");

  const create = useMutation({
    ...orpc.note.create.mutationOptions(),
    onSuccess: async () => {
      setBody("");
      onBookingChange(null);
      await queryClient.invalidateQueries({ queryKey: orpc.note.key() });
    },
    onError: (error) => toast.error(error.message),
  });

  function submit() {
    const parsed = clientNoteBodySchema.safeParse(body);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Проверьте заметку");
      return;
    }
    create.mutate({
      practiceId,
      memberId,
      bookingId: bookingId ?? undefined,
      body: parsed.data,
    });
  }

  // No encryption key on this server: there is nothing to write into.
  if (
    notes.isError &&
    isDefinedError(notes.error) &&
    notes.error.code === "UNAVAILABLE"
  ) {
    return (
      <EmptyState
        icon={LockIcon}
        title="Заметки недоступны"
        description="Не настроено шифрование заметок. Напишите в поддержку."
      />
    );
  }

  const items = Object.fromEntries([
    [NO_SESSION, "О клиенте в целом"],
    ...sessions.map((s) => [s.id, sessionLabel(s.startsAt)]),
  ]);

  return (
    <div className="ph-no-capture flex flex-col gap-4">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="note-session">К чему заметка</Label>
          <Select
            items={items}
            value={bookingId ?? NO_SESSION}
            onValueChange={(value) =>
              onBookingChange(
                value && value !== NO_SESSION ? String(value) : null,
              )
            }
          >
            <SelectTrigger id="note-session" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SESSION}>О клиенте в целом</SelectItem>
              {sessions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {sessionLabel(s.startsAt)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Textarea
          aria-label="Текст заметки"
          rows={4}
          maxLength={CLIENT_NOTE_MAX}
          placeholder="Запрос, о чём говорили, что дальше"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <p className="flex flex-1 items-center gap-1.5 text-xs text-muted-foreground">
            <LockIcon className="size-3.5 shrink-0" aria-hidden />
            Видите только вы. Хранятся зашифрованными.
          </p>
          <Button
            type="submit"
            size="sm"
            disabled={create.isPending || body.trim() === ""}
          >
            Сохранить
          </Button>
        </div>
      </form>

      {notes.isError ? (
        <ErrorState onRetry={() => notes.refetch()} />
      ) : notes.isPending ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : notes.data.length === 0 ? (
        <EmptyState
          icon={NotebookPenIcon}
          title="Заметок пока нет"
          description="Записывайте запрос, ход работы и договорённости — всё в одном месте с записями клиента."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {notes.data.map((note) => (
            <NoteItem key={note.id} practiceId={practiceId} note={note} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteItem({ practiceId, note }: { practiceId: string; note: Note }) {
  const terms = useTerms();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);

  const update = useMutation({
    ...orpc.note.update.mutationOptions(),
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: orpc.note.key() });
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useMutation({
    ...orpc.note.remove.mutationOptions(),
    onSuccess: async () => {
      toast.success("Заметка удалена");
      await queryClient.invalidateQueries({ queryKey: orpc.note.key() });
    },
    onError: (error) => toast.error(error.message),
  });

  function save() {
    const parsed = clientNoteBodySchema.safeParse(draft);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Проверьте заметку");
      return;
    }
    update.mutate({ practiceId, noteId: note.id, body: parsed.data });
  }

  const edited =
    note.updatedAt &&
    note.updatedAt.getTime() - note.createdAt.getTime() > 60_000;

  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground first-letter:uppercase">
          {note.bookingStartsAt
            ? `${capitalize(terms.credit[0])} · ${sessionLabel(note.bookingStartsAt)}`
            : "О клиенте"}
        </span>
        <span>
          {note.createdAt.toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          {edited && " · изменена"}
        </span>
      </div>
      {draft === null ? (
        <>
          <p className="text-sm break-words whitespace-pre-wrap">{note.body}</p>
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setDraft(note.body)}
            >
              <PencilIcon />
              Изменить
            </Button>
            <ConfirmButton
              variant="ghost"
              size="xs"
              title="Удалить заметку?"
              description="Её нельзя будет вернуть."
              confirmLabel="Удалить"
              disabled={remove.isPending}
              onConfirm={() => remove.mutate({ practiceId, noteId: note.id })}
            >
              <TrashIcon />
              Удалить
            </ConfirmButton>
          </div>
        </>
      ) : (
        <>
          <Textarea
            aria-label="Текст заметки"
            rows={4}
            maxLength={CLIENT_NOTE_MAX}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
              Отмена
            </Button>
            <Button
              size="sm"
              disabled={update.isPending || draft.trim() === ""}
              onClick={save}
            >
              Сохранить
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
