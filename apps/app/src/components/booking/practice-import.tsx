"use client";

import type { RouterOutputs } from "@synoro/api";
import {
  Button,
  Checkbox,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  toast,
} from "@synoro/ui";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import { Badge } from "@synoro/ui/reui/badge";
import { Frame, FramePanel } from "@synoro/ui/reui/frame";
import {
  IMPORT_FIELD_LABELS,
  IMPORT_FIELDS,
  type ImportField,
} from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDaysIcon,
  CircleAlertIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  UploadIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import { orpc } from "~/orpc/react";
import { saveTextFile } from "../settings/data-access";
import { ErrorState, PageHeading } from "./states";

type Upload = RouterOutputs["import"]["upload"];
type Uploaded = Extract<Upload, { kind: "table" }>;
type CalendarDraft = { kind: "calendar"; id: string; events: number };
type ArchiveDraft = Extract<Upload, { kind: "archive" }>;
type Preview = RouterOutputs["import"]["preview"];
type Batch = RouterOutputs["import"]["list"][number];

const SKIP = "skip";
/** Above this the page polls: the worker writes it in the background. */
const POLL_MS = 3000;

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function clients(n: number) {
  return `${n} ${plural(n, "клиент", "клиента", "клиентов")}`;
}

function UploadStep({
  practiceId,
  onDone,
}: {
  practiceId: string;
  onDone: (uploaded: Upload) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    ...orpc.import.upload.mutationOptions(),
    onSuccess: onDone,
    onError: (error) => toast.error(error.message),
  });
  const google = useQuery(
    orpc.googleCalendar.settings.queryOptions({ input: { practiceId } }),
  );
  const fromGoogle = useMutation({
    ...orpc.import.fromGoogle.mutationOptions(),
    onSuccess: onDone,
    onError: (error) => toast.error(error.message),
  });
  const pending = upload.isPending || fromGoogle.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold tracking-tight">
          Загрузите файл
        </h2>
        <p className="text-sm text-muted-foreground">
          Таблица с клиентами (CSV или XLSX), календарь (ICS) или архив из
          Synoro, до 10 МБ. Пока вы не подтвердите, ничего не изменится. Клиенты
          ничего не получат: ни писем, ни сообщений.
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept=".csv,.txt,.xlsx,.ics,.json,.zip,text/csv,text/calendar,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        aria-label="Файл с клиентами"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload.mutate({ practiceId, file });
          event.target.value = "";
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => input.current?.click()}>
          {upload.isPending ? <Spinner /> : <UploadIcon />}
          Выбрать файл
        </Button>
        {google.data?.connection && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => fromGoogle.mutate({ practiceId })}
          >
            {fromGoogle.isPending ? <Spinner /> : <CalendarDaysIcon />}
            Взять из Google Календаря
          </Button>
        )}
      </div>
    </div>
  );
}

function formatEvent(at: Date, timezone: string) {
  return at.toLocaleString("ru-RU", {
    timeZone: timezone,
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * A calendar's future events. Whether they're bookings or just closed time
 * can't be told from the file, so the specialist says.
 */
function CalendarStep({
  draft,
  timezone,
  onBack,
  onApplied,
}: {
  draft: CalendarDraft;
  timezone: string;
  onBack: () => void;
  onApplied: () => void;
}) {
  const [eventsAs, setEventsAs] = useState<"bookings" | "blocked">("bookings");
  const [consent, setConsent] = useState(false);
  const preview = useQuery(
    orpc.import.previewEvents.queryOptions({
      input: { batchId: draft.id, eventsAs },
    }),
  );
  const commit = useMutation({
    ...orpc.import.commit.mutationOptions(),
    onSuccess: onApplied,
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold tracking-tight">
          Что это за события
        </h2>
        <RadioGroup
          value={eventsAs}
          onValueChange={(value) => setEventsAs(value as typeof eventsAs)}
        >
          <Label className="flex items-start gap-2 font-normal">
            <RadioGroupItem value="bookings" />
            Записи клиентов: название события станет именем клиента
          </Label>
          <Label className="flex items-start gap-2 font-normal">
            <RadioGroupItem value="blocked" />
            Занятое время: на него никто не сможет записаться
          </Label>
        </RadioGroup>
      </div>

      {preview.isError ? (
        <ErrorState onRetry={() => preview.refetch()} />
      ) : preview.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-medium">Будет добавлено: {preview.data.added}</p>
          {preview.data.samples.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {preview.data.samples.map((row) => (
                <li key={row.startsAt.toISOString()}>
                  {formatEvent(row.startsAt, timezone)}:{" "}
                  {row.title || "без названия"}
                </li>
              ))}
            </ul>
          )}
          <ul className="flex flex-col gap-1 text-muted-foreground">
            {preview.data.past > 0 && (
              <li>Уже прошли, не переносим: {preview.data.past}</li>
            )}
            {preview.data.allDay > 0 && (
              <li>
                На весь день, для записей не подходят: {preview.data.allDay}
              </li>
            )}
            {preview.data.tooLong > 0 && (
              <li>Длиннее суток, не переносим: {preview.data.tooLong}</li>
            )}
            {preview.data.partial > 0 && (
              <li>
                Сложное повторение, взяли только первую дату:{" "}
                {preview.data.partial}
              </li>
            )}
            {preview.data.conflicts.total > 0 && (
              <li>
                Пересекаются с тем, что уже есть, пропустим:{" "}
                {preview.data.conflicts.total}
              </li>
            )}
          </ul>
          {preview.data.conflicts.total > 0 && (
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-xs text-muted-foreground">
              {preview.data.conflicts.samples.map((row) => (
                <li key={`${row.title}-${row.startsAt.toISOString()}`}>
                  {formatEvent(row.startsAt, timezone)}:{" "}
                  {row.title || "без названия"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {eventsAs === "bookings" && (
        <div className="flex items-start gap-3">
          <Checkbox
            id="calendar-consent"
            checked={consent}
            onCheckedChange={setConsent}
            className="mt-0.5"
          />
          <Label htmlFor="calendar-consent" className="font-normal">
            Эти люди — мои клиенты, и я вправе хранить их записи в Synoro
          </Label>
        </div>
      )}

      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          Другой файл
        </Button>
        <Button
          disabled={
            commit.isPending ||
            !preview.data?.added ||
            (eventsAs === "bookings" && !consent)
          }
          onClick={() =>
            commit.mutate({
              batchId: draft.id,
              eventsAs,
              duplicates: "skip",
              importNotes: false,
              consent: true,
            })
          }
        >
          {commit.isPending && <Spinner />}
          Загрузить
        </Button>
      </div>
    </div>
  );
}

/**
 * An archive downloaded from Synoro. It can hold several practices; one goes
 * into this practice at a time. Settings come along only into an empty one.
 */
function ArchiveStep({
  draft,
  onBack,
  onApplied,
}: {
  draft: ArchiveDraft;
  onBack: () => void;
  onApplied: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [consent, setConsent] = useState(false);
  const preview = useQuery(
    orpc.import.previewArchive.queryOptions({
      input: { batchId: draft.id, practiceIndex: index },
    }),
  );
  const commit = useMutation({
    ...orpc.import.commit.mutationOptions(),
    onSuccess: onApplied,
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold tracking-tight">
          Архив из Synoro
        </h2>
        {draft.practices.length > 1 && (
          <RadioGroup
            value={String(index)}
            onValueChange={(value) => setIndex(Number(value))}
          >
            {draft.practices.map((practice, i) => (
              <Label
                key={`${practice.name}-${practice.clients}-${practice.bookings}`}
                className="flex items-start gap-2 font-normal"
              >
                <RadioGroupItem value={String(i)} />
                {practice.name}
              </Label>
            ))}
          </RadioGroup>
        )}
      </div>

      {preview.isError ? (
        <ErrorState onRetry={() => preview.refetch()} />
      ) : preview.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <ul className="flex flex-col gap-1">
            <li>Клиенты: {preview.data.clients}</li>
            <li>Записи: {preview.data.bookings}</li>
            <li>
              История оплат и баланса:{" "}
              {preview.data.payments + preview.data.creditEntries}
            </li>
          </ul>
          <p className="text-muted-foreground">
            {preview.data.clean
              ? `Настройки практики тоже загрузятся: название «${preview.data.name}», рабочие часы, анкета, пакеты и сообщения клиентам.`
              : "В этой практике уже есть данные, поэтому её настройки мы не меняем: добавим только клиентов и записи."}
          </p>
          <p className="text-muted-foreground">
            Клиенты с личным кабинетом перенесутся как карточки: кабинет
            появится, когда они сами запишутся. Ключи оплаты, подключение Google
            Календаря и адрес страницы не переносятся, их нужно будет настроить
            заново.
          </p>
        </div>
      )}

      <div className="flex items-start gap-3">
        <Checkbox
          id="archive-consent"
          checked={consent}
          onCheckedChange={setConsent}
          className="mt-0.5"
        />
        <Label htmlFor="archive-consent" className="font-normal">
          Эти люди — мои клиенты, и я вправе хранить их данные в Synoro
        </Label>
      </div>

      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          Другой файл
        </Button>
        <Button
          disabled={commit.isPending || !consent || !preview.data}
          onClick={() =>
            commit.mutate({
              batchId: draft.id,
              archivePractice: index,
              duplicates: "skip",
              importNotes: true,
              consent: true,
            })
          }
        >
          {commit.isPending && <Spinner />}
          Загрузить
        </Button>
      </div>
    </div>
  );
}

function MappingStep({
  uploaded,
  mapping,
  onChange,
  onBack,
  onNext,
  pending,
}: {
  uploaded: Uploaded;
  mapping: (ImportField | null)[];
  onChange: (mapping: (ImportField | null)[]) => void;
  onBack: () => void;
  onNext: () => void;
  pending: boolean;
}) {
  const hasName = mapping.some(
    (field) =>
      field === "name" || field === "firstName" || field === "lastName",
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold tracking-tight">
          Что в каких колонках
        </h2>
        <p className="text-sm text-muted-foreground">
          Мы подставили то, что поняли по заголовкам. Проверьте и поправьте,
          лишние колонки можно не переносить. Строк в файле: {uploaded.rowCount}
          .
        </p>
      </div>
      <ul className="flex flex-col divide-y">
        {uploaded.headers.map((header, index) => (
          // A column's place is its identity: headers may repeat or be empty.
          // biome-ignore lint/suspicious/noArrayIndexKey: columns never reorder
          <li key={index} className="flex flex-wrap items-center gap-3 py-2">
            <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
              <span className="truncate text-sm font-medium">
                {header || `Колонка ${index + 1}`}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {uploaded.sample
                  .map((row) => row[index])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join(", ") || "пусто"}
              </span>
            </div>
            <Select
              value={mapping[index] ?? SKIP}
              onValueChange={(value) => {
                const next = [...mapping];
                const field = value === SKIP ? null : (value as ImportField);
                // Each field once: the old column lets it go.
                for (const [i, taken] of next.entries()) {
                  if (field && taken === field) next[i] = null;
                }
                next[index] = field;
                onChange(next);
              }}
              items={[
                { value: SKIP, label: "Не переносить" },
                ...IMPORT_FIELDS.map((field) => ({
                  value: field,
                  label: IMPORT_FIELD_LABELS[field],
                })),
              ]}
            >
              <SelectTrigger
                className="w-48"
                aria-label={`Что в колонке ${header || index + 1}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SKIP}>Не переносить</SelectItem>
                {IMPORT_FIELDS.map((field) => (
                  <SelectItem key={field} value={field}>
                    {IMPORT_FIELD_LABELS[field]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </li>
        ))}
      </ul>
      {!hasName && (
        <Alert variant="warning">
          <CircleAlertIcon />
          <AlertTitle>Выберите колонку с именем</AlertTitle>
          <AlertDescription>
            Без имени мы не сможем показать клиента в списке.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          Другой файл
        </Button>
        <Button disabled={!hasName || pending} onClick={onNext}>
          {pending && <Spinner />}
          Посмотреть, что получится
        </Button>
      </div>
    </div>
  );
}

function PreviewStep({
  uploaded,
  mapping,
  preview,
  onBack,
  onApplied,
}: {
  uploaded: Uploaded;
  mapping: (ImportField | null)[];
  preview: Preview;
  onBack: () => void;
  onApplied: () => void;
}) {
  const [duplicates, setDuplicates] = useState<"merge" | "skip">("skip");
  const [importNotes, setImportNotes] = useState(false);
  const [consent, setConsent] = useState(false);

  const commit = useMutation({
    ...orpc.import.commit.mutationOptions(),
    onSuccess: onApplied,
    onError: (error) => toast.error(error.message),
  });
  const rejected = useMutation({
    ...orpc.import.rejected.mutationOptions(),
    onSuccess: ({ csv, filename }) =>
      saveTextFile(filename, csv, "text/csv;charset=utf-8"),
    onError: (error) => toast.error(error.message),
  });

  const mergeable = preview.duplicates.total - preview.duplicates.members;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold tracking-tight">
          Вот что получится
        </h2>
        <ul className="flex flex-col gap-1 text-sm">
          <li>Будет добавлено: {clients(preview.added)}</li>
          {preview.duplicates.total > 0 && (
            <li>
              Уже есть в Synoro или повторяются в файле:{" "}
              {preview.duplicates.total}
            </li>
          )}
          {preview.errors.total > 0 && (
            <li>Не получится добавить: {preview.errors.total}</li>
          )}
        </ul>
      </div>

      {mergeable > 0 && (
        <div className="flex flex-col gap-2">
          <Label>Что делать с повторами</Label>
          <RadioGroup
            value={duplicates}
            onValueChange={(value) => setDuplicates(value as typeof duplicates)}
          >
            <Label className="flex items-start gap-2 font-normal">
              <RadioGroupItem value="skip" />
              Пропустить
            </Label>
            <Label className="flex items-start gap-2 font-normal">
              <RadioGroupItem value="merge" />
              Объединить: дописать то, чего не хватает. Уже заполненное не
              изменится
            </Label>
          </RadioGroup>
          {preview.duplicates.members > 0 && (
            <p className="text-xs text-muted-foreground">
              Клиентов с личным кабинетом ({preview.duplicates.members}) мы не
              меняем: их контакты принадлежат им самим.
            </p>
          )}
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-xs text-muted-foreground">
            {preview.duplicates.samples.map((row) => (
              <li key={row.line}>
                Строка {row.line}: {row.name}, совпадает{" "}
                {row.by === "phone" ? "телефон" : "почта"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.errors.total > 0 && (
        <div className="flex flex-col gap-2">
          <Label>Строки с ошибками</Label>
          <p className="text-sm text-muted-foreground">
            Остальные клиенты всё равно загрузятся. Эти строки можно скачать,
            исправить и загрузить отдельно.
          </p>
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-xs text-muted-foreground">
            {preview.errors.samples.map((row) => (
              <li key={row.line}>
                Строка {row.line}: {row.reasons.join(", ")}
              </li>
            ))}
          </ul>
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={rejected.isPending}
              onClick={() => rejected.mutate({ batchId: uploaded.id, mapping })}
            >
              <DownloadIcon />
              Скачать строки с ошибками
            </Button>
          </div>
        </div>
      )}

      {preview.notes > 0 && (
        <div className="flex items-start gap-3">
          <Checkbox
            id="import-notes"
            checked={importNotes}
            onCheckedChange={setImportNotes}
            className="mt-0.5"
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor="import-notes">
              Перенести заметки ({preview.notes})
            </Label>
            <p className="text-xs text-muted-foreground">
              Synoro не предназначен для медицинских записей. Если в заметках
              есть диагнозы или подробности работы с клиентом, лучше оставить их
              у себя.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-start gap-3">
        <Checkbox
          id="import-consent"
          checked={consent}
          onCheckedChange={setConsent}
          className="mt-0.5"
        />
        <Label htmlFor="import-consent" className="font-normal">
          Эти люди — мои клиенты, и я вправе хранить их контакты в Synoro
        </Label>
      </div>

      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          Назад
        </Button>
        <Button
          disabled={
            !consent || commit.isPending || preview.added + mergeable === 0
          }
          onClick={() =>
            commit.mutate({
              batchId: uploaded.id,
              mapping,
              duplicates,
              importNotes,
              consent: true,
            })
          }
        >
          {commit.isPending && <Spinner />}
          Загрузить
        </Button>
      </div>
    </div>
  );
}

function statusBadge(batch: Batch) {
  switch (batch.status) {
    case "applying":
      return <Badge variant="info-light">Загружаем</Badge>;
    case "applied":
      return <Badge variant="success-light">Загружено</Badge>;
    case "failed":
      return <Badge variant="destructive-light">Прервалось</Badge>;
    case "undone":
      return <Badge variant="outline">Отменено</Badge>;
    default:
      return null;
  }
}

function History({ practiceId }: { practiceId: string }) {
  const queryClient = useQueryClient();
  const history = useQuery({
    ...orpc.import.list.queryOptions({ input: { practiceId } }),
    refetchInterval: (query) =>
      query.state.data?.some((batch) => batch.status === "applying")
        ? POLL_MS
        : false,
  });
  const undo = useMutation({
    ...orpc.import.undo.mutationOptions(),
    onSuccess: async ({ removed }) => {
      toast.success(`Загрузка отменена, удалено записей: ${removed}`);
      await queryClient.invalidateQueries({ queryKey: orpc.import.key() });
    },
    onError: (error) => toast.error(error.message),
  });
  const rejected = useMutation({
    ...orpc.import.rejected.mutationOptions(),
    onSuccess: ({ csv, filename }) =>
      saveTextFile(filename, csv, "text/csv;charset=utf-8"),
    onError: (error) => toast.error(error.message),
  });

  if (history.isError) return <ErrorState onRetry={() => history.refetch()} />;
  if (history.isPending) return <Skeleton className="h-16 w-full" />;
  if (history.data.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold tracking-tight">
        Прошлые загрузки
      </h2>
      <ul className="flex flex-col divide-y">
        {history.data.map((batch) => (
          <li
            key={batch.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {batch.fileName}
                {statusBadge(batch)}
              </span>
              <span className="text-xs text-muted-foreground">
                {batch.createdAt.toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "long",
                })}
                {batch.status === "applying"
                  ? `, обработано ${batch.progress} из ${batch.rowCount}`
                  : batch.totals
                    ? `, добавлено ${batch.totals.added}, объединено ${batch.totals.merged}, пропущено ${batch.totals.skipped}, с ошибками ${batch.totals.errors}`
                    : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {(batch.totals?.errors ?? 0) > 0 &&
                batch.status === "applied" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={rejected.isPending}
                    onClick={() => rejected.mutate({ batchId: batch.id })}
                  >
                    Строки с ошибками
                  </Button>
                )}
              {(batch.status === "applied" || batch.status === "failed") && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={undo.isPending}
                  onClick={() => undo.mutate({ batchId: batch.id })}
                >
                  Отменить этот импорт
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Bringing clients in from a table: the file, its columns, what will happen,
 * then the writing. Nothing is written before the last step, and any import can
 * be undone later. `ph-no-capture`: it shows real people's names.
 */
export function PracticeImport({
  practiceId,
  timezone,
}: {
  practiceId: string;
  timezone: string;
}) {
  const queryClient = useQueryClient();
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);
  const [calendar, setCalendar] = useState<CalendarDraft | null>(null);
  const [archive, setArchive] = useState<ArchiveDraft | null>(null);
  const [mapping, setMapping] = useState<(ImportField | null)[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);

  const analyze = useMutation({
    ...orpc.import.preview.mutationOptions(),
    onSuccess: setPreview,
    onError: (error) => toast.error(error.message),
  });

  function reset() {
    setUploaded(null);
    setCalendar(null);
    setArchive(null);
    setMapping([]);
    setPreview(null);
  }

  async function done() {
    toast.success("Загружаем. Итог появится ниже");
    reset();
    await queryClient.invalidateQueries({ queryKey: orpc.import.key() });
  }

  return (
    <div className="ph-no-capture flex max-w-3xl flex-col gap-6">
      <PageHeading
        title="Перенос клиентов"
        description="Из таблицы или другого сервиса записи, без ручного перебивания"
      />
      <Frame spacing="default" className="min-w-0">
        <FramePanel>
          {calendar ? (
            <CalendarStep
              draft={calendar}
              timezone={timezone}
              onBack={reset}
              onApplied={done}
            />
          ) : archive ? (
            <ArchiveStep draft={archive} onBack={reset} onApplied={done} />
          ) : !uploaded ? (
            <UploadStep
              practiceId={practiceId}
              onDone={(file) => {
                if (file.kind === "calendar") {
                  setCalendar(file);
                } else if (file.kind === "archive") {
                  setArchive(file);
                } else {
                  setUploaded(file);
                  setMapping(file.mapping);
                }
              }}
            />
          ) : !preview ? (
            <MappingStep
              uploaded={uploaded}
              mapping={mapping}
              onChange={setMapping}
              onBack={reset}
              pending={analyze.isPending}
              onNext={() => analyze.mutate({ batchId: uploaded.id, mapping })}
            />
          ) : (
            <PreviewStep
              uploaded={uploaded}
              mapping={mapping}
              preview={preview}
              onBack={() => setPreview(null)}
              onApplied={done}
            />
          )}
        </FramePanel>
      </Frame>
      <History practiceId={practiceId} />
    </div>
  );
}

/** The cards of clients brought in, under the list of those with a cabinet. */
export function ImportedClients({
  practiceId,
  search,
}: {
  practiceId: string;
  search: string;
}) {
  const cards = useQuery(
    orpc.import.clients.queryOptions({ input: { practiceId } }),
  );
  if (!cards.data || cards.data.length === 0) return null;

  const query = search.trim().toLowerCase();
  const digits = query.replace(/\D/g, "");
  const shown = cards.data.filter(
    (card) =>
      !query ||
      card.name.toLowerCase().includes(query) ||
      card.email?.includes(query) ||
      (digits !== "" && card.phone?.includes(digits)),
  );
  if (shown.length === 0) return null;

  return (
    <div className="ph-no-capture flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <FileSpreadsheetIcon className="size-4 text-muted-foreground" />
          Перенесённые клиенты
        </h2>
        <p className="text-sm text-muted-foreground">
          Они ничего от нас не получают. Личный кабинет появится, если клиент
          сам запишется на вашей странице.
        </p>
      </div>
      <ul className="flex flex-col divide-y">
        {shown.map((card) => (
          <li key={card.id} className="flex flex-col gap-0.5 py-2">
            <span className="text-sm font-medium">{card.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {[card.phone, card.email].filter(Boolean).join(", ") ||
                "контактов нет"}
              {card.credits > 0 && `, на балансе ${card.credits}`}
            </span>
            {card.note && (
              <span className="text-xs text-muted-foreground">{card.note}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
