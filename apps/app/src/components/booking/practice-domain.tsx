"use client";

import { isDefinedError, ORPCError } from "@orpc/client";
import {
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@synoro/ui";
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
import { customDomainFormSchema } from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheckIcon,
  CircleXIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { client, orpc } from "~/orpc/react";
import { ProRequired } from "../billing/pro-required";
import { SaveState } from "../settings/save-state";
import { ConfirmButton } from "./confirm-button";
import {
  DomainProgress,
  DomainReady,
  type DomainStage,
  STAGE_BADGE,
} from "./domain-progress";
import { ErrorState } from "./states";

/** How often the page checks while waiting: often at first, then calmer. */
const checkInterval = (checks: number) => (checks < 40 ? 8_000 : 30_000);

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Скопировано");
  } catch {
    toast.info(text);
  }
}

function LinkRow({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} aria-label={label} />
      <Button
        variant="outline"
        size="icon"
        aria-label="Скопировать ссылку"
        onClick={() => copy(new URL(value, window.location.origin).href)}
      >
        <CopyIcon />
      </Button>
      <Button
        variant="outline"
        size="icon"
        aria-label="Открыть"
        nativeButton={false}
        render={<a href={value} target="_blank" rel="noreferrer" />}
      >
        <ExternalLinkIcon />
      </Button>
    </div>
  );
}

function CheckMark({ ok }: { ok: boolean | undefined }) {
  if (ok === undefined) return null;
  return ok ? (
    <CircleCheckIcon
      key="ok"
      className="size-4 animate-in text-success duration-300 zoom-in-50 motion-reduce:animate-none"
      aria-label="Найдена"
    />
  ) : (
    <CircleXIcon
      key="no"
      className="size-4 text-muted-foreground"
      aria-label="Пока не найдена"
    />
  );
}

/**
 * Where the practice's booking page lives: the main address, and the
 * specialist's own domain — connected with a TXT record (ownership) plus a
 * CNAME or ALIAS record (routing). Owner only. The certificate is issued by the
 * cluster once the routing record is seen (docs/custom-domains.md).
 *
 * Until the domain works over https the page re-runs `domain.verify` in the
 * background and walks the steps (TXT → DNS → SSL → ready) as they pass.
 */
export function PracticeDomain({
  practiceId,
  bookingUrl,
  isOwner,
}: {
  practiceId: string;
  bookingUrl: string;
  isOwner: boolean;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const queryKey = orpc.domain.get.queryKey({ input: { practiceId } });
  const settings = useQuery({
    ...orpc.domain.get.queryOptions({ input: { practiceId } }),
    enabled: isOwner,
  });
  const [hostname, setHostname] = useState("");
  const [inputError, setInputError] = useState<string>();
  // Became ready while the owner watched: worth a celebration.
  const [celebrate, setCelebrate] = useState(false);

  const save = (data: NonNullable<typeof settings.data>) =>
    queryClient.setQueryData(queryKey, data);
  const checkKey = ["domain-check", practiceId] as const;

  const domain = settings.data?.domain;
  const live = useQuery({
    queryKey: [...checkKey, domain?.hostname],
    queryFn: async () => {
      const checking = domain?.hostname;
      const { check, stage, ...data } = await client.domain.verify({
        practiceId,
      });
      const before = queryClient.getQueryData(queryKey)?.domain;
      // Disconnected or replaced while this check ran: its answer is about a
      // domain that is no longer on the screen, so it must not bring it back.
      if (before?.hostname !== checking) return { check, stage };
      save(data);
      if (stage === "ready" && !before?.securedAt) {
        setCelebrate(true);
        toast.success(`Готово: ${data.domain?.displayHostname} работает`);
      }
      // The sidebar and «Сегодня» show the domain only while it works.
      if (!!before?.securedAt !== !!data.domain?.securedAt) router.refresh();
      return { check, stage };
    },
    // Watch until https works; once secured, only on «Проверить».
    enabled: isOwner && !!domain && !domain.securedAt,
    refetchInterval: (query) =>
      isDefinedError(query.state.error) || query.state.data?.stage === "ready"
        ? false
        : checkInterval(query.state.dataUpdateCount),
    retry: false,
  });
  const check = live.data?.check;
  const expired =
    live.error instanceof ORPCError &&
    live.error.code === "RESERVATION_EXPIRED";
  // A defined error (signed out, no longer the owner…) stops the checks;
  // anything else (the network) is retried on the next tick.
  const stopped = isDefinedError(live.error);
  const checks =
    queryClient.getQueryState([...checkKey, domain?.hostname])
      ?.dataUpdateCount ?? 0;

  const connect = useMutation({
    ...orpc.domain.connect.mutationOptions(),
    onSuccess: (data) => {
      save(data);
      setHostname("");
      setCelebrate(false);
      queryClient.removeQueries({ queryKey: checkKey });
    },
    onError: (error) =>
      isDefinedError(error)
        ? setInputError(error.message)
        : toast.error("Не удалось подключить домен"),
  });

  const disconnect = useMutation({
    ...orpc.domain.disconnect.mutationOptions(),
    onSuccess: (data) => {
      save(data);
      setCelebrate(false);
      queryClient.removeQueries({ queryKey: checkKey });
      toast.success("Домен отключён");
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = customDomainFormSchema.safeParse({ hostname });
    if (!parsed.success) {
      setInputError(parsed.error.issues[0]?.message);
      return;
    }
    setInputError(undefined);
    connect.mutate({ practiceId, hostname: parsed.data.hostname });
  }

  const platform = (
    <Frame spacing="default" className="min-w-0">
      <FramePanel className="flex flex-col gap-4">
        <FrameHeader className="p-0">
          <FrameTitle>Адрес на платформе</FrameTitle>
          <FrameDescription>
            Работает сразу, настраивать ничего не нужно
          </FrameDescription>
        </FrameHeader>
        <LinkRow value={bookingUrl} label="Основной адрес" />
      </FramePanel>
    </Frame>
  );

  if (!isOwner) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <Alert variant="info">
          <GlobeIcon />
          <AlertTitle>Домен подключает владелец практики</AlertTitle>
          <AlertDescription>
            Ссылка на страницу записи — {bookingUrl}
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  if (settings.isPending)
    return <Skeleton className="h-96 max-w-3xl rounded-xl" />;
  if (settings.isError) {
    return (
      <ErrorState
        message="Не удалось загрузить настройки домена."
        onRetry={() => settings.refetch()}
      />
    );
  }

  const { targetsConfigured, pro } = settings.data;
  const routing = domain?.records.filter((r) => r.purpose === "routing") ?? [];
  const stage: DomainStage =
    live.data?.stage ??
    (domain?.securedAt
      ? "ready"
      : domain?.status === "active"
        ? "routing"
        : "ownership");

  const checkButton = (
    <Button
      size="sm"
      variant="outline"
      disabled={live.isFetching}
      onClick={() => live.refetch()}
    >
      <RefreshCwIcon className={live.isFetching ? "animate-spin" : undefined} />
      {stage === "ready" ? "Проверить ещё раз" : "Проверить сейчас"}
    </Button>
  );
  const disconnectButton = domain && (
    <ConfirmButton
      title="Отключить домен?"
      description={`Страница перестанет открываться на ${domain.displayHostname}. Ссылки на платформе продолжат работать.`}
      confirmLabel="Отключить"
      disabled={disconnect.isPending}
      onConfirm={() => disconnect.mutate({ practiceId })}
    >
      Отключить
    </ConfirmButton>
  );

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Frame spacing="default" className="min-w-0">
        <FramePanel className="flex flex-col gap-4">
          <FrameHeader className="p-0">
            <FrameTitle>Свой домен</FrameTitle>
            <FrameDescription>
              Страница записи по вашему адресу: anna-psy.ru или
              zapis.anna-psy.ru
            </FrameDescription>
          </FrameHeader>

          {!domain && !pro ? (
            <ProRequired feature="Свой домен" />
          ) : !domain ? (
            <form onSubmit={submit} className="flex flex-col gap-3">
              <Field data-invalid={!!inputError}>
                <FieldLabel htmlFor="domain-hostname">Домен</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="domain-hostname"
                    placeholder="anna-psy.ru"
                    autoComplete="off"
                    spellCheck={false}
                    value={hostname}
                    aria-invalid={!!inputError}
                    onChange={(e) => {
                      setHostname(e.target.value);
                      setInputError(undefined);
                    }}
                  />
                  <Button
                    type="submit"
                    disabled={connect.isPending || !hostname}
                  >
                    Подключить
                  </Button>
                </div>
                <FieldDescription>
                  Домен нужно заранее купить у регистратора (REG.RU, RU-CENTER и
                  т. п.). Кириллические домены (.рф) тоже подходят.
                </FieldDescription>
                <FieldError>{inputError}</FieldError>
              </Field>
              <SaveState dirty={hostname.trim() !== ""} savedAt={null} />
            </form>
          ) : stage === "ready" ? (
            <DomainReady
              hostname={domain.displayHostname}
              url={domain.url}
              celebrate={celebrate}
              actions={
                <>
                  {checkButton}
                  {disconnectButton}
                </>
              }
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <GlobeIcon className="size-4 text-muted-foreground" />
                <span className="font-medium break-all">
                  {domain.displayHostname}
                </span>
                <Badge variant={STAGE_BADGE[stage].variant}>
                  {STAGE_BADGE[stage].label}
                </Badge>
                <div className="ml-auto flex gap-2">
                  {checkButton}
                  {disconnectButton}
                </div>
              </div>

              {expired ? (
                <Alert variant="warning">
                  <AlertTitle>Срок проверки истёк</AlertTitle>
                  <AlertDescription className="flex flex-col items-start gap-2">
                    За сутки TXT-запись так и не появилась. Подключите домен
                    заново — мы выдадим новую запись.
                    <Button
                      size="sm"
                      disabled={connect.isPending}
                      onClick={() =>
                        connect.mutate({
                          practiceId,
                          hostname: domain.hostname,
                        })
                      }
                    >
                      Подключить заново
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : (
                <DomainProgress
                  stage={stage}
                  stopped={stopped}
                  checking={live.isFetching}
                  checkedAt={live.dataUpdatedAt}
                  interval={checkInterval(checks)}
                />
              )}

              {live.isError && !expired && (
                <Alert variant={stopped ? "destructive" : "warning"}>
                  <AlertTitle>
                    {stopped
                      ? "Проверка остановлена"
                      : "Не удалось проверить домен"}
                  </AlertTitle>
                  <AlertDescription>
                    {stopped
                      ? `${live.error.message}. Затем нажмите «Проверить сейчас».`
                      : "Повторим автоматически. Если ошибка не уходит, проверьте подключение к интернету."}
                  </AlertDescription>
                </Alert>
              )}

              {!targetsConfigured && (
                <Alert variant="warning">
                  <AlertTitle>Адрес платформы для DNS не задан</AlertTitle>
                  <AlertDescription>
                    Подтвердить владение можно уже сейчас, но направить домен на
                    платформу получится после настройки сервера
                    (CUSTOM_DOMAIN_CNAME).
                  </AlertDescription>
                </Alert>
              )}

              {stage !== "certificate" && (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">
                    Добавьте записи в DNS у регистратора домена
                  </span>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Тип</TableHead>
                        <TableHead>Имя</TableHead>
                        <TableHead>Значение</TableHead>
                        <TableHead className="w-8" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {domain.records.map((record) => (
                        <TableRow key={`${record.type}-${record.name}`}>
                          <TableCell className="align-top">
                            <div className="flex flex-col items-start gap-1">
                              <Badge variant="info-light">{record.type}</Badge>
                              {record.purpose === "routing" &&
                                routing.length > 1 &&
                                record.recommended && (
                                  <span className="text-xs text-muted-foreground">
                                    рекомендуем
                                  </span>
                                )}
                            </div>
                          </TableCell>
                          {[record.name, record.value].map((text) => (
                            <TableCell
                              key={text}
                              className="max-w-56 align-top whitespace-normal"
                            >
                              <button
                                type="button"
                                onClick={() => copy(text)}
                                className="flex max-w-full items-center gap-1.5 rounded-sm text-left font-mono text-xs break-all transition-colors hover:text-primary"
                              >
                                {text}
                                <CopyIcon className="size-3 shrink-0 opacity-50" />
                              </button>
                            </TableCell>
                          ))}
                          <TableCell className="align-top">
                            <CheckMark
                              ok={
                                record.purpose === "ownership"
                                  ? domain.status === "active" ||
                                    check?.ownership
                                  : check?.routing
                              }
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
                <li>
                  TXT подтверждает, что домен ваш. Его можно удалить после
                  подключения.
                </li>
                {routing.length > 1 && (
                  <li>
                    Из CNAME и ALIAS нужна одна запись: CNAME — для поддомена
                    (zapis.anna-psy.ru). Для домена целиком (anna-psy.ru) CNAME
                    не бывает: нужна ALIAS (у некоторых регистраторов — ANAME
                    или «CNAME flattening»). Если у вашего регистратора такой
                    записи нет, подключите поддомен, например zapis.anna-psy.ru.
                  </li>
                )}
                <li>
                  Если у регистратора поле «Имя» без домена, укажите только
                  начало: «_booking-verification» или «@» для корня.
                </li>
                <li>
                  Изменения DNS расходятся от нескольких минут до суток. Если у
                  регистратора включено проксирование или CDN для домена,
                  выключите его: записи должны вести прямо на платформу.
                </li>
              </ul>
            </>
          )}
        </FramePanel>
        <FrameFooter className="text-xs text-muted-foreground">
          Вход и запись клиентов проходят на платформе — с вашего домена они
          перейдут туда по кнопке «Войти и записаться».
        </FrameFooter>
      </Frame>

      {platform}
    </div>
  );
}
