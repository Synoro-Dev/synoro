"use client";

import type { RouterOutputs } from "@synoro/api";
import {
  Button,
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
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import { IconTile } from "@synoro/ui/reui/icon-tile";
import { capitalize, formatCredits } from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, CreditCardIcon, ReceiptIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { ProRequired } from "../billing/pro-required";
import { ConfirmButton } from "../booking/confirm-button";
import { EmptyState, ErrorState, PageHeading } from "../booking/states";
import { useTerms } from "../booking/terms";
import { formatDateTime } from "../booking/time";
import { formatRub, PAYMENT_STATUS } from "./format";
import { PackagesEditor } from "./packages-editor";
import { ProviderForm, TAX_SYSTEM_LABELS } from "./provider-form";

type Settings = RouterOutputs["payment"]["settings"];

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Скопировано");
  } catch {
    toast.info(text);
  }
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Frame spacing="default" className="min-w-0">
      <FramePanel className="flex flex-col gap-4">
        <FrameHeader className="p-0">
          <FrameTitle>{title}</FrameTitle>
          <FrameDescription>{description}</FrameDescription>
        </FrameHeader>
        {children}
      </FramePanel>
    </Frame>
  );
}

function ConnectedAccount({
  practiceId,
  settings,
  onChange,
  onEdit,
}: {
  practiceId: string;
  settings: Settings;
  onChange: (settings: Settings) => void;
  onEdit: () => void;
}) {
  const terms = useTerms();
  const account = settings.account;
  const disconnect = useMutation({
    ...orpc.payment.disconnect.mutationOptions(),
    onSuccess: (data) => {
      onChange(data);
      toast.success("Онлайн-оплата отключена");
    },
    onError: (error) => toast.error(error.message),
  });
  if (!account) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <IconTile variant="soft" aria-hidden="true">
          <CreditCardIcon />
        </IconTile>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium">{account.providerName}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {account.merchantId}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="success-light">Подключена</Badge>
          {account.test && (
            <Badge variant="warning-light">Тестовый режим</Badge>
          )}
          {account.receipts && (
            <Badge variant="info-light">
              Чеки
              {account.taxSystem &&
                ` · ${TAX_SYSTEM_LABELS[account.taxSystem]}`}
            </Badge>
          )}
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={onEdit}>
            Изменить
          </Button>
          <ConfirmButton
            title="Отключить онлайн-оплату?"
            description="Клиенты перестанут видеть кнопку «Пополнить». Начатые платежи всё равно зачислятся."
            confirmLabel="Отключить"
            disabled={disconnect.isPending}
            onConfirm={() => disconnect.mutate({ practiceId })}
          >
            Отключить
          </ConfirmButton>
        </div>
      </div>

      {account.test && (
        <Alert variant="warning">
          <AlertTitle>Тестовый магазин</AlertTitle>
          <AlertDescription>
            Деньги не списываются, а {terms.credits} начисляются по-настоящему.
            Перед запуском подключите боевые ключи.
          </AlertDescription>
        </Alert>
      )}

      {account.provider === "yookassa" ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">
            Добавьте адрес для уведомлений в ЮKassa
          </span>
          <div className="flex gap-2">
            <Input
              readOnly
              value={settings.notificationUrls.yookassa}
              aria-label="Адрес для уведомлений"
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="Скопировать адрес"
              onClick={() => copy(settings.notificationUrls.yookassa)}
            >
              <CopyIcon />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Личный кабинет ЮKassa → Интеграция → HTTP-уведомления: вставьте
            адрес и отметьте события payment.succeeded и payment.canceled. Без
            этого оплата зачислится, когда клиент вернётся на сайт.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Уведомления об оплате Т-Банк присылает автоматически — настраивать
          ничего не нужно. Терминал должен быть одностадийным.
        </p>
      )}
    </div>
  );
}

function ProviderSection({ practiceId }: { practiceId: string }) {
  const queryClient = useQueryClient();
  const queryKey = orpc.payment.settings.queryKey({ input: { practiceId } });
  const settings = useQuery(
    orpc.payment.settings.queryOptions({ input: { practiceId } }),
  );
  const [editing, setEditing] = useState(false);

  const saved = (data: Settings) => {
    queryClient.setQueryData(queryKey, data);
    void queryClient.invalidateQueries({
      queryKey: orpc.payment.packages.key(),
    });
    setEditing(false);
  };

  return (
    <Section
      title="Платёжная система"
      description="Клиенты платят на ваш счёт в ЮKassa или Т-Банке — платформа не касается денег"
    >
      {settings.isError ? (
        <ErrorState onRetry={() => settings.refetch()} />
      ) : settings.isPending ? (
        <Skeleton className="h-32 w-full rounded-md" />
      ) : !settings.data.available ? (
        <Alert variant="warning">
          <AlertTitle>Онлайн-оплата не настроена на сервере</AlertTitle>
          <AlertDescription>
            Администратору платформы нужно задать PAYMENTS_SECRET_KEY — им
            шифруются ключи магазинов.
          </AlertDescription>
        </Alert>
      ) : !settings.data.pro ? (
        <ProRequired feature="Онлайн-оплата" />
      ) : settings.data.account && !editing ? (
        <ConnectedAccount
          practiceId={practiceId}
          settings={settings.data}
          onChange={saved}
          onEdit={() => setEditing(true)}
        />
      ) : (
        <ProviderForm
          practiceId={practiceId}
          settings={settings.data}
          onSaved={saved}
          onCancel={settings.data.account ? () => setEditing(false) : undefined}
        />
      )}
    </Section>
  );
}

function PaymentsSection({ practiceId }: { practiceId: string }) {
  const terms = useTerms();
  const list = useQuery(
    orpc.payment.list.queryOptions({ input: { practiceId } }),
  );

  return (
    <Section
      title="Платежи"
      description={`Онлайн-оплаты клиентов; ${terms.credits} зачисляются автоматически`}
    >
      {list.isError ? (
        <ErrorState onRetry={() => list.refetch()} />
      ) : list.isPending ? (
        <Skeleton className="h-40 w-full rounded-md" />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              ["За 30 дней", formatRub(list.data.month.amount)],
              [capitalize(terms.credit[2]), String(list.data.month.credits)],
              ["Платежей", String(list.data.month.count)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex flex-col gap-0.5 rounded-md border p-3"
              >
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className="text-lg font-semibold tabular-nums">
                  {value}
                </span>
              </div>
            ))}
          </div>
          {list.data.payments.length === 0 ? (
            <EmptyState
              icon={ReceiptIcon}
              title="Платежей пока нет"
              description="Когда клиент оплатит пакет, он появится здесь."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Клиент</TableHead>
                  <TableHead>Пакет</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead>Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {formatDateTime(p.paidAt ?? p.createdAt)}
                    </TableCell>
                    <TableCell className="max-w-48">
                      <div className="flex flex-col">
                        <span className="truncate">{p.clientName ?? "—"}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {p.clientEmail}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatCredits(p.credits, terms)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">
                      {formatRub(p.amount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={PAYMENT_STATUS[p.status].badge}>
                        {PAYMENT_STATUS[p.status].label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </Section>
  );
}

/**
 * Online payments of a practice: the owner connects ЮKassa or Т-Банк and
 * sets the prices; all staff see incoming payments.
 */
export function PracticePayments({
  practiceId,
  isOwner,
}: {
  practiceId: string;
  isOwner: boolean;
}) {
  const terms = useTerms();
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeading
        title="Оплата"
        description="Клиенты сами пополняют баланс онлайн"
      />
      {isOwner ? (
        <>
          <ProviderSection practiceId={practiceId} />
          <Section
            title="Цены"
            description={`Что клиент может купить: ${terms.credits} по одной цене или пакетом со скидкой`}
          >
            <PackagesEditor practiceId={practiceId} />
          </Section>
        </>
      ) : (
        <Alert variant="info">
          <CreditCardIcon />
          <AlertTitle>Оплату и цены настраивает владелец практики</AlertTitle>
          <AlertDescription>
            Здесь видны платежи клиентов. Пополнить баланс вручную можно в
            разделе «Клиенты».
          </AlertDescription>
        </Alert>
      )}
      <PaymentsSection practiceId={practiceId} />
    </div>
  );
}
