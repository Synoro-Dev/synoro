import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@synoro/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireAdmin } from "~/auth/server";
import { Pager, SearchForm } from "~/components/list-toolbar";
import { PageHeader } from "~/components/page-header";
import { PaymentStatus, PERIOD_LABELS } from "~/components/payment-status";
import { TableSkeleton } from "~/components/table-skeleton";
import { formatDateTime, formatKopecks } from "~/lib/format";
import { listHref, listParams, type SearchParams } from "~/lib/list-params";
import { api } from "~/orpc/server";

export const metadata: Metadata = { title: "Платежи «Про»" };

const STATUSES = [
  { value: undefined, label: "Все" },
  { value: "succeeded", label: "Оплачены" },
  { value: "pending", label: "Ожидают" },
  { value: "canceled", label: "Отменены" },
  { value: "refunded", label: "Возвраты" },
] as const;

type Status = Exclude<(typeof STATUSES)[number]["value"], undefined>;

const isStatus = (value: string | undefined): value is Status =>
  STATUSES.some((status) => status.value && status.value === value);

export default function PaymentsPage(props: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader title="Платежи «Про»" />
      <div className="flex flex-col gap-4 p-4">
        <Suspense fallback={<TableSkeleton />}>
          <Payments searchParams={props.searchParams} />
        </Suspense>
      </div>
    </>
  );
}

async function Payments({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const { params, page, input, first } = await listParams(searchParams);
  const requested = first(params.status);
  const status = isStatus(requested) ? requested : undefined;
  const { items, total } = await api.payments.list({ ...input, status });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchForm
          action="/payments"
          query={input.query}
          placeholder="Имя, почта или № заказа"
        >
          {status && <input type="hidden" name="status" value={status} />}
        </SearchForm>
        <div className="flex flex-wrap gap-1">
          {STATUSES.map((option) => (
            <Button
              key={option.label}
              size="sm"
              variant={option.value === status ? "secondary" : "ghost"}
              render={
                <Link
                  href={
                    listHref("/payments", params, {
                      status: option.value,
                      page: undefined,
                    }) as Route
                  }
                />
              }
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>№</TableHead>
            <TableHead>Кто</TableHead>
            <TableHead>Период</TableHead>
            <TableHead className="text-right">Сумма</TableHead>
            <TableHead>Статус</TableHead>
            <TableHead>Создан</TableHead>
            <TableHead>Оплачен</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={7}
                className="text-muted-foreground h-24 text-center"
              >
                Платежей нет
              </TableCell>
            </TableRow>
          )}
          {items.map((payment) => (
            <TableRow key={payment.id}>
              <TableCell className="tabular-nums">{payment.number}</TableCell>
              <TableCell>
                <Link
                  href={`/users/${payment.user.id}` as Route}
                  className="flex flex-col hover:underline"
                >
                  <span>{payment.user.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {payment.user.email}
                  </span>
                </Link>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  {PERIOD_LABELS[payment.period]}
                  {payment.automatic && (
                    <Badge variant="outline">автопродление</Badge>
                  )}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatKopecks(payment.amount)}
              </TableCell>
              <TableCell>
                <PaymentStatus
                  status={payment.status}
                  refundedAt={payment.refundedAt}
                />
              </TableCell>
              <TableCell>{formatDateTime(payment.createdAt)}</TableCell>
              <TableCell>{formatDateTime(payment.paidAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager pathname="/payments" params={params} page={page} total={total} />
    </>
  );
}
