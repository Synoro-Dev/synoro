"use client";

import { paths } from "@acme/config";
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
} from "@acme/ui";
import { Alert, AlertDescription, AlertTitle } from "@acme/ui/reui/alert";
import { Badge } from "@acme/ui/reui/badge";
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@acme/ui/reui/frame";
import { customDomainFormSchema } from "@acme/validators";
import { isDefinedError } from "@orpc/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheckIcon,
  CircleXIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { ConfirmButton } from "./confirm-button";
import { ErrorState } from "./states";

type DnsCheck = { ownership: boolean; routing: boolean };

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
    <CircleCheckIcon className="size-4 text-success" aria-label="Найдена" />
  ) : (
    <CircleXIcon className="size-4 text-destructive" aria-label="Не найдена" />
  );
}

/**
 * Where the practice's booking page lives: the platform subdomain, and the
 * specialist's own domain — connected with a TXT record (ownership) plus a
 * CNAME or A record (routing). Owner only.
 */
export function PracticeDomain({
  practiceId,
  slug,
  isOwner,
}: {
  practiceId: string;
  slug: string;
  isOwner: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = orpc.domain.get.queryKey({ input: { practiceId } });
  const settings = useQuery({
    ...orpc.domain.get.queryOptions({ input: { practiceId } }),
    enabled: isOwner,
  });
  const [hostname, setHostname] = useState("");
  const [inputError, setInputError] = useState<string>();
  const [check, setCheck] = useState<DnsCheck>();

  const save = (data: NonNullable<typeof settings.data>) =>
    queryClient.setQueryData(queryKey, data);

  const connect = useMutation({
    ...orpc.domain.connect.mutationOptions(),
    onSuccess: (data) => {
      save(data);
      setHostname("");
      setCheck(undefined);
    },
    onError: (error) =>
      isDefinedError(error)
        ? setInputError(error.message)
        : toast.error("Не удалось подключить домен"),
  });

  const verify = useMutation({
    ...orpc.domain.verify.mutationOptions(),
    onSuccess: ({ check: result, ...data }) => {
      save(data);
      setCheck(result);
      if (data.domain?.status !== "active") {
        toast.warning("TXT-запись пока не видна. DNS обновляется до суток.");
      } else if (!result.routing) {
        toast.info("Домен подтверждён. Осталось направить его на платформу.");
      } else {
        toast.success("Домен подключён");
      }
    },
    onError: (error) => toast.error(error.message),
  });

  const disconnect = useMutation({
    ...orpc.domain.disconnect.mutationOptions(),
    onSuccess: (data) => {
      save(data);
      setCheck(undefined);
      toast.success("Домен отключён");
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
        {settings.data?.platformUrl && (
          <LinkRow value={settings.data.platformUrl} label="Поддомен" />
        )}
        <LinkRow value={paths.booking.public(slug)} label="Ссылка для записи" />
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
            Ссылка на страницу записи — {paths.booking.public(slug)}
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

  const { domain, targetsConfigured } = settings.data;
  const routing = domain?.records.filter((r) => r.purpose === "routing") ?? [];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {platform}

      <Frame spacing="default" className="min-w-0">
        <FramePanel className="flex flex-col gap-4">
          <FrameHeader className="p-0">
            <FrameTitle>Свой домен</FrameTitle>
            <FrameDescription>
              Страница записи по вашему адресу: anna-psy.ru или
              zapis.anna-psy.ru
            </FrameDescription>
          </FrameHeader>

          {!domain ? (
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
            </form>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <GlobeIcon className="size-4 text-muted-foreground" />
                <span className="font-medium">{domain.displayHostname}</span>
                <Badge
                  variant={
                    domain.status === "active"
                      ? "success-light"
                      : "warning-light"
                  }
                >
                  {domain.status === "active"
                    ? "Подключён"
                    : "Ожидает проверки"}
                </Badge>
                <div className="ml-auto flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={verify.isPending}
                    onClick={() => verify.mutate({ practiceId })}
                  >
                    <RefreshCwIcon />
                    Проверить DNS
                  </Button>
                  <ConfirmButton
                    title="Отключить домен?"
                    description={`Страница перестанет открываться на ${domain.displayHostname}. Ссылки на платформе продолжат работать.`}
                    confirmLabel="Отключить"
                    disabled={disconnect.isPending}
                    onConfirm={() => disconnect.mutate({ practiceId })}
                  >
                    Отключить
                  </ConfirmButton>
                </div>
              </div>

              {domain.status === "active" && (
                <LinkRow
                  value={`https://${domain.hostname}`}
                  label="Ваш домен"
                />
              )}

              {!targetsConfigured && (
                <Alert variant="warning">
                  <AlertTitle>Адрес платформы для DNS не задан</AlertTitle>
                  <AlertDescription>
                    Подтвердить владение можно уже сейчас, но направить домен на
                    платформу получится после настройки сервера
                    (CUSTOM_DOMAIN_CNAME / CUSTOM_DOMAIN_IP).
                  </AlertDescription>
                </Alert>
              )}

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
                                ? check?.ownership
                                : check?.routing
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
                <li>
                  TXT подтверждает, что домен ваш. Его можно удалить после
                  подключения.
                </li>
                {routing.length > 1 && (
                  <li>
                    Из CNAME и A нужна одна запись: CNAME — для поддомена
                    (zapis.anna-psy.ru), A — для домена целиком (anna-psy.ru).
                  </li>
                )}
                <li>
                  Если у регистратора поле «Имя» без домена, укажите только
                  начало: «_booking-verification» или «@» для корня.
                </li>
                <li>
                  Изменения DNS расходятся от нескольких минут до суток. Если
                  домен за Cloudflare, выключите проксирование (серое облако).
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
    </div>
  );
}
