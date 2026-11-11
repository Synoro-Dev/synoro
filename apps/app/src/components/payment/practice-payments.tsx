"use client";

import type { RouterOutputs } from "@synoro/api";
import { paths } from "@synoro/config";
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
import { capitalize, formatCredits } from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  FlaskConicalIcon,
  ReceiptIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  OfflinePayments,
  UnpaidBookings,
} from "~/components/payment/offline-payments";
import { ExportPartButton } from "~/components/settings/export-part-button";
import { orpc } from "~/orpc/react";
import { ProRequired } from "../billing/pro-required";
import { ConfirmButton } from "../booking/confirm-button";
import { EmptyState, ErrorState, PageHeading } from "../booking/states";
import { useTerms } from "../booking/terms";
import { formatDateTime } from "../booking/time";
import { CopyStateIcon, useCopied } from "../copy-value";
import { FoldedBlock } from "./folded-block";
import { formatRub, PAYMENT_STATUS } from "./format";
import { PackagesEditor } from "./packages-editor";
import { ProviderForm, TAX_SYSTEM_LABELS } from "./provider-form";

type Settings = RouterOutputs["payment"]["settings"];

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

/** The connection, said in one phrase. */
function ConnectionPhrase({
  account,
  pro,
}: {
  account: Settings["account"];
  /** Without «Про» clients can't pay, even with a shop connected. */
  pro: boolean;
}) {
  const terms = useTerms();
  const {
    icon: Icon,
    tone,
    text,
  } = !pro
    ? {
        icon: CircleDashedIcon,
        tone: "text-warning-foreground",
        text: account
          ? "Онлайн-оплата приостановлена: она входит в «Про». Оплатите тариф, и клиенты снова смогут платить сами."
          : "Онлайн-оплата входит в «Про». Оплатите тариф, чтобы клиенты могли платить сами.",
      }
    : !account
      ? {
          icon: CircleDashedIcon,
          tone: "text-muted-foreground",
          text: "Онлайн-оплата не подключена: клиенты пока не могут заплатить сами.",
        }
      : account.test
        ? {
            icon: FlaskConicalIcon,
            tone: "text-warning-foreground",
            text: `Подключён тестовый магазин ${account.providerName}: деньги не списываются, а ${terms.credits} начисляются по-настоящему.`,
          }
        : {
            icon: CircleCheckIcon,
            tone: "text-brand",
            text: `Онлайн-оплата работает: клиенты платят напрямую на ваш счёт в ${account.providerName}.`,
          };
  return (
    <p className="flex min-w-0 items-start gap-2 text-sm">
      <Icon className={`mt-0.5 size-4 shrink-0 ${tone}`} aria-hidden="true" />
      <span className="min-w-0">{text}</span>
    </p>
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
  const account = settings.account;
  const { copied, copy } = useCopied();
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
      <ConnectionPhrase account={account} pro={settings.pro} />
      <div className="flex flex-wrap gap-2">
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

      <FoldedBlock title="Уведомления, чеки и налоги">
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex flex-wrap justify-between gap-x-4">
            <dt className="text-muted-foreground">Магазин</dt>
            <dd className="break-all">
              {account.providerName}, {account.merchantId}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-x-4">
            <dt className="text-muted-foreground">Чеки клиентам</dt>
            <dd>
              {account.receipts
                ? account.taxSystem
                  ? `Отправляются, ${TAX_SYSTEM_LABELS[account.taxSystem]}`
                  : "Отправляются"
                : "Не отправляются"}
            </dd>
          </div>
        </dl>
        {account.provider === "yookassa" ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Адрес для уведомлений</span>
            <div className="flex gap-2">
              <Input
                readOnly
                value={settings.notificationUrls.yookassa}
                aria-label="Адрес для уведомлений"
                className="text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                aria-label="Скопировать адрес"
                onClick={() => copy(settings.notificationUrls.yookassa)}
              >
                <CopyStateIcon copied={copied} />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              С ним оплата зачисляется сразу, без него — когда клиент вернётся
              на сайт. В личном кабинете ЮKassa откройте Интеграция →
              HTTP-уведомления, вставьте адрес и отметьте события
              payment.succeeded и payment.canceled.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Уведомления об оплате Т-Банк присылает сам, настраивать ничего не
            нужно. Терминал должен быть одностадийным.
          </p>
        )}
      </FoldedBlock>
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
      title="Куда приходят деньги"
      description="Клиенты платят на ваш счёт в ЮKassa или Т-Банке, Synoro денег не касается"
    >
      {settings.isError ? (
        <ErrorState onRetry={() => settings.refetch()} />
      ) : settings.isPending ? (
        <Skeleton className="h-32 w-full rounded-md" />
      ) : !settings.data.available ? (
        <Alert variant="warning">
          <AlertTitle>Онлайн-оплата пока недоступна</AlertTitle>
          <AlertDescription>
            Её должна включить команда Synoro. Как только это случится, здесь
            появится подключение.
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
        <>
          <ConnectionPhrase
            account={settings.data.account}
            pro={settings.data.pro}
          />
          <ProviderForm
            practiceId={practiceId}
            settings={settings.data}
            onSaved={saved}
            onCancel={
              settings.data.account ? () => setEditing(false) : undefined
            }
          />
        </>
      )}
    </Section>
  );
}

/** The owner's way to the provider and the prices, above the payments. */
function ConnectionStatus({ practiceId }: { practiceId: string }) {
  const settings = useQuery(
    orpc.payment.settings.queryOptions({ input: { practiceId } }),
  );
  if (!settings.data?.available) return null;
  return (
    <Frame spacing="default" className="min-w-0">
      <FramePanel className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ConnectionPhrase
          account={settings.data.account}
          pro={settings.data.pro}
        />
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={
            <Link
              href={
                settings.data.pro
                  ? paths.booking.onlinePayment(practiceId)
                  : paths.booking.plan(practiceId)
              }
            />
          }
        >
          {settings.data.pro ? "Подключение и цены" : "Тариф"}
          <ArrowRightIcon />
        </Button>
      </FramePanel>
    </Frame>
  );
}

function PaymentsSection({ practiceId }: { practiceId: string }) {
  const terms = useTerms();
  const list = useQuery(
    orpc.payment.list.queryOptions({ input: { practiceId } }),
  );

  return (
    <Section
      title="Онлайн-оплаты"
      description={`Через ЮKassa или Т-Банк; ${terms.credits} зачисляются автоматически`}
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
 * The owner's settings of online payment: the provider clients pay through
 * and the prices. The money coming in is on `PracticePayments`.
 */
export function PracticeOnlinePayment({ practiceId }: { practiceId: string }) {
  const terms = useTerms();
  return (
    <div className="flex max-w-3xl min-w-0 flex-col gap-6">
      <PageHeading
        title="Онлайн-оплата"
        description="Клиенты сами оплачивают записи и пополняют баланс"
      />
      <ProviderSection practiceId={practiceId} />
      <Section
        title="Цены"
        description={`Что клиент может купить: ${terms.credits} по одной цене или пакетом со скидкой`}
      >
        <PackagesEditor practiceId={practiceId} />
      </Section>
    </div>
  );
}

/**
 * The money coming in, for all staff: bookings paid at the visit still
 * awaiting payment, payments received outside Synoro, online payments. The
 * owner also sees the connection and takes the income out for the tax return.
 */
export function PracticePayments({
  practiceId,
  timezone,
  isOwner,
}: {
  practiceId: string;
  timezone: string;
  isOwner: boolean;
}) {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeading
        title="Оплаты"
        description="Всё, что клиенты заплатили: онлайн и напрямую вам. Пакет, оплаченный напрямую, начисляйте в карточке клиента — с суммой он попадёт и сюда."
        actions={
          isOwner ? (
            <ExportPartButton
              what="income"
              practiceId={practiceId}
              timezone={timezone}
            />
          ) : undefined
        }
      />
      {isOwner ? <ConnectionStatus practiceId={practiceId} /> : null}
      <UnpaidBookings practiceId={practiceId} timezone={timezone} />
      <OfflinePayments practiceId={practiceId} timezone={timezone} />
      <PaymentsSection practiceId={practiceId} />
    </div>
  );
}
