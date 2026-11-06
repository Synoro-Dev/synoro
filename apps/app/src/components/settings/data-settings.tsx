"use client";

import { isDefinedError } from "@orpc/client";
import type { RouterOutputs } from "@synoro/api";
import {
  Button,
  Checkbox,
  Input,
  Label,
  Skeleton,
  Switch,
  toast,
} from "@synoro/ui";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import { Badge } from "@synoro/ui/reui/badge";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDaysIcon,
  CircleAlertIcon,
  CopyIcon,
  DownloadIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { ErrorState } from "../booking/states";
import { useDataAccess } from "./data-access";
import { DeleteAccountSection } from "./delete-account";

type Overview = RouterOutputs["data"]["overview"];
type ExportRow = RouterOutputs["data"]["exports"][number];
type AuditRow = RouterOutputs["data"]["audit"][number];

function formatDay(at: Date) {
  return at.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function formatMoment(at: Date) {
  return at.toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} КБ`
    : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function ExportLine({ row }: { row: ExportRow }) {
  const name = row.kind === "weekly" ? "Копия базы клиентов" : "Все данные";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">
          {name}, {formatDay(row.createdAt)}
        </span>
        <span className="text-xs text-muted-foreground">
          {row.status === "ready" && row.expiresAt
            ? `Можно скачать до ${formatDay(row.expiresAt)}${
                row.sizeBytes ? `, ${formatSize(row.sizeBytes)}` : ""
              }`
            : row.status === "expired"
              ? "Срок вышел, архив удалён"
              : row.status === "failed"
                ? "Не получилось собрать. Попробуйте ещё раз"
                : "Собираем. Когда будет готово, пришлём письмо"}
        </span>
      </div>
      {row.status === "ready" ? (
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          // Not a Link: the browser downloads it.
          render={<a href={`/api/exports/${row.id}/download`} />}
        >
          <DownloadIcon />
          Скачать
        </Button>
      ) : row.status === "failed" ? (
        <Badge variant="destructive-light">Ошибка</Badge>
      ) : row.status === "expired" ? (
        <Badge variant="outline">Удалён</Badge>
      ) : (
        <Badge variant="info-light">Собираем</Badge>
      )}
    </li>
  );
}

function ArchiveSection() {
  const queryClient = useQueryClient();
  const access = useDataAccess();
  const exports_ = useQuery({
    ...orpc.data.exports.queryOptions(),
    refetchInterval: (query) =>
      query.state.data?.some(
        (row) => row.status === "pending" || row.status === "running",
      )
        ? 4000
        : false,
  });
  const start = useMutation({
    ...orpc.data.startExport.mutationOptions(),
    onSuccess: async () => {
      toast.success("Собираем архив. Когда будет готово, пришлём письмо");
      await queryClient.invalidateQueries({ queryKey: orpc.data.key() });
    },
    onError: (error) => access.onError(error, () => start.mutate()),
  });

  return (
    <Section
      title="Скачать все мои данные"
      description="Клиенты, записи, услуги и оплаты в одном архиве: таблицы для Excel, файл для календаря и полная копия для других программ. Бесплатно, на любом тарифе. Ссылка работает 7 дней, скачать архив можно только из вашего аккаунта."
    >
      <div>
        <Button disabled={start.isPending} onClick={() => start.mutate()}>
          <DownloadIcon />
          Скачать все мои данные
        </Button>
      </div>
      {access.dialog}
      {exports_.isError ? (
        <ErrorState onRetry={() => exports_.refetch()} />
      ) : exports_.isPending ? (
        <Skeleton className="h-14 w-full" />
      ) : exports_.data.length > 0 ? (
        <ul className="flex flex-col divide-y">
          {exports_.data.map((row) => (
            <ExportLine key={row.id} row={row} />
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

function FeedLine({ practice }: { practice: Overview["practices"][number] }) {
  const queryClient = useQueryClient();
  const access = useDataAccess();
  // Only the hash is stored: the link is seen once, right after issuing it.
  const [url, setUrl] = useState<string | null>(null);
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: orpc.data.key() });
  const input = { practiceId: practice.id };

  const issue = useMutation({
    ...orpc.data.issueFeed.mutationOptions(),
    onSuccess: async (result) => {
      setUrl(result.url);
      await invalidate();
    },
    onError: (error) => access.onError(error, () => issue.mutate(input)),
  });
  const disable = useMutation({
    ...orpc.data.disableFeed.mutationOptions(),
    onSuccess: async () => {
      setUrl(null);
      toast.success("Подписка отключена, ссылка больше не работает");
      await invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const setNames = useMutation({
    ...orpc.data.setFeedNames.mutationOptions(),
    onSuccess: invalidate,
    onError: (error, variables) =>
      access.onError(error, () => setNames.mutate(variables)),
  });

  const feed = practice.feed;
  const busy = issue.isPending || disable.isPending;

  return (
    <li className="flex flex-col gap-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">{practice.name}</span>
          <span className="text-xs text-muted-foreground">
            {!feed
              ? "Подписка выключена"
              : feed.lastFetchedAt
                ? `Календарь обращался ${formatMoment(feed.lastFetchedAt)}`
                : "Подписка включена, календарь ещё не обращался"}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {feed ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => issue.mutate(input)}
              >
                Выпустить новую ссылку
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => disable.mutate(input)}
              >
                Отключить
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => issue.mutate(input)}
            >
              <CalendarDaysIcon />
              Включить подписку
            </Button>
          )}
        </div>
      </div>

      {url && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              readOnly
              value={url}
              aria-label="Ссылка на календарь"
              onFocus={(event) => event.target.select()}
            />
            <Button
              variant="outline"
              aria-label="Скопировать ссылку"
              onClick={() =>
                navigator.clipboard
                  .writeText(url)
                  .then(() => toast.success("Ссылка скопирована"))
              }
            >
              <CopyIcon />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Сохраните ссылку сейчас: мы показываем её один раз. Добавьте её в
            Google Календарь («Другие календари» → «Добавить по URL») или в
            Яндекс Календарь («Подписаться на календарь»). Календари обновляются
            сами, но не сразу: Google, например, может обновить данные только
            через несколько часов.
          </p>
        </div>
      )}

      {feed && (
        <div className="flex items-start gap-3">
          <Switch
            id={`feed-names-${practice.id}`}
            checked={feed.showNames}
            disabled={setNames.isPending}
            onCheckedChange={(checked) =>
              setNames.mutate({ ...input, showNames: checked })
            }
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`feed-names-${practice.id}`}>
              Показывать имена и телефоны клиентов
            </Label>
            <p className="text-xs text-muted-foreground">
              Выключено: в календаре только «Запись» и время. Если включить,
              имена и телефоны попадут на серверы сервиса календаря, в том числе
              за пределами России, и их увидят все, кому открыт этот календарь.
            </p>
          </div>
        </div>
      )}
      {access.dialog}
    </li>
  );
}

function BackupSection({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const access = useDataAccess();
  const save = useMutation({
    ...orpc.data.setBackup.mutationOptions(),
    onSuccess: async (result) => {
      toast.success(
        result.enabled
          ? "Каждый понедельник будем присылать ссылку на копию"
          : "Копия отключена",
      );
      await queryClient.invalidateQueries({ queryKey: orpc.data.key() });
    },
    onError: (error, variables) =>
      access.onError(error, () => save.mutate(variables)),
  });

  return (
    <Section
      title="Копия базы клиентов"
      description="На случай, если хочется иметь свежую копию под рукой, не вспоминая об этом."
    >
      <div className="flex items-start gap-3">
        <Checkbox
          id="client-backup"
          checked={enabled}
          disabled={save.isPending}
          onCheckedChange={(checked) => save.mutate({ enabled: checked })}
          className="mt-0.5"
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="client-backup">Присылать копию раз в неделю</Label>
          <p className="text-xs text-muted-foreground">
            По понедельникам придёт письмо со ссылкой на таблицу клиентов. Сами
            данные в письмо не вкладываем: скачать таблицу можно только после
            входа в аккаунт.
          </p>
        </div>
      </div>
      {access.dialog}
    </Section>
  );
}

const AUDIT_LABELS: Record<AuditRow["action"], string> = {
  access_confirmed: "Подтверждён вход для работы с данными",
  export_requested: "Запрошен архив",
  export_downloaded: "Скачан архив",
  partial_export: "Выгружена таблица",
  feed_enabled: "Включена подписка на календарь",
  feed_rotated: "Выпущена новая ссылка на календарь",
  feed_disabled: "Отключена подписка на календарь",
  backup_enabled: "Включена недельная копия",
  backup_disabled: "Отключена недельная копия",
  import_applied: "Загружены данные",
  import_undone: "Отменена загрузка",
  deletion_requested: "Запрошено удаление аккаунта",
  deletion_cancelled: "Удаление аккаунта отменено",
};

function auditDetail(row: AuditRow) {
  const { kind, what } = row.details;
  if (kind === "weekly") return "недельная копия";
  if (what === "clients") return "клиенты";
  if (what === "appointments") return "записи за период";
  return null;
}

function JournalSection() {
  const audit = useQuery(orpc.data.audit.queryOptions());

  return (
    <Section
      title="Журнал"
      description="Кто и когда выгружал, загружал или удалял данные. Записи хранятся 12 месяцев."
    >
      {audit.isError ? (
        <ErrorState onRetry={() => audit.refetch()} />
      ) : audit.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : audit.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Пока ничего не было.</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {audit.data.map((row) => {
            const detail = auditDetail(row);
            return (
              <li key={row.id} className="flex flex-col gap-0.5 py-2">
                <span className="text-sm">
                  {AUDIT_LABELS[row.action]}
                  {detail && `: ${detail}`}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatMoment(row.createdAt)}
                  {row.actorName ? `, ${row.actorName}` : ", автоматически"}
                  {row.practiceName && `, ${row.practiceName}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

/**
 * «Ваши данные»: the archive, the calendar subscription, the weekly copy and
 * the journal. `ph-no-capture`: session replay records page text, and a secret
 * link and a journal are not for it.
 */
export function DataSettings() {
  const overview = useQuery(orpc.data.overview.queryOptions());

  if (overview.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (overview.isError) {
    return isDefinedError(overview.error) &&
      overview.error.code === "FORBIDDEN" ? (
      <Alert variant="warning">
        <CircleAlertIcon />
        <AlertTitle>Здесь это недоступно</AlertTitle>
        <AlertDescription>
          Выгрузка данных работает только из аккаунта владельца: не на
          демо-стенде и не при входе от чужого имени.
        </AlertDescription>
      </Alert>
    ) : (
      <ErrorState onRetry={() => overview.refetch()} />
    );
  }

  const { practices, backup } = overview.data;

  return (
    <div className="ph-no-capture flex flex-col gap-8">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold tracking-tight">Ваши данные</h2>
        <p className="text-sm text-muted-foreground">
          Всё, что вы ведёте в Synoro, принадлежит вам. Забрать это можно в
          любой момент.
        </p>
      </div>

      {practices.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Выгрузка появится, когда у вас будет своя практика.
        </p>
      ) : (
        <>
          <div id="archive" className="scroll-mt-4">
            <ArchiveSection />
          </div>
          <Section
            title="Подписка на расписание"
            description="Ваши записи в Google или Яндекс Календаре по секретной ссылке. Календарь будет обновляться сам."
          >
            <ul className="flex flex-col divide-y">
              {practices.map((practice) => (
                <FeedLine key={practice.id} practice={practice} />
              ))}
            </ul>
          </Section>
          <BackupSection enabled={backup} />
        </>
      )}
      <JournalSection />
      <DeleteAccountSection email={overview.data.email} />
    </div>
  );
}
