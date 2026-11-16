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
import { PaymentStatus } from "~/components/payment-status";
import { TableSkeleton } from "~/components/table-skeleton";
import { formatDateTime, formatKopecks } from "~/lib/format";
import { bookingPageUrl } from "~/lib/links";
import { listHref, listParams, type SearchParams } from "~/lib/list-params";
import { api } from "~/orpc/server";

export const metadata: Metadata = { title: "Покупки адресов" };

const STATUSES = [
  { value: undefined, label: "Все" },
  { value: "succeeded", label: "Оплачены" },
  { value: "pending", label: "Ожидают" },
  { value: "canceled", label: "Отменены" },
] as const;

type Status = Exclude<(typeof STATUSES)[number]["value"], undefined>;

const isStatus = (value: string | undefined): value is Status =>
  STATUSES.some((status) => status.value && status.value === value);

export default function SlugOrdersPage(props: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader title="Покупки адресов" />
      <div className="flex flex-col gap-4 p-4">
        <Suspense fallback={<TableSkeleton />}>
          <Orders searchParams={props.searchParams} />
        </Suspense>
      </div>
    </>
  );
}

async function Orders({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const { params, page, input, first } = await listParams(searchParams);
  const requested = first(params.status);
  const status = isStatus(requested) ? requested : undefined;
  const { items, total } = await api.slugOrders.list({ ...input, status });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchForm
          action="/slug-orders"
          query={input.query}
          placeholder="Адрес, № заказа, имя, почта или практика"
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
                    listHref("/slug-orders", params, {
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
            <TableHead>Адрес</TableHead>
            <TableHead>Практика</TableHead>
            <TableHead>Кто</TableHead>
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
                colSpan={8}
                className="text-muted-foreground h-24 text-center"
              >
                Заказов нет
              </TableCell>
            </TableRow>
          )}
          {items.map((order) => (
            <TableRow key={order.id}>
              <TableCell className="tabular-nums">{order.number}</TableCell>
              <TableCell>
                <a
                  href={bookingPageUrl(order.slug)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  /{order.slug}
                </a>
              </TableCell>
              <TableCell>
                {order.practice ? (
                  <Link
                    href={`/practices/${order.practice.id}` as Route}
                    className="flex flex-col hover:underline"
                  >
                    <span>{order.practice.name}</span>
                    <span className="text-muted-foreground text-xs">
                      /{order.practice.slug}
                    </span>
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {order.user ? (
                  <Link
                    href={`/users/${order.user.id}` as Route}
                    className="flex flex-col hover:underline"
                  >
                    <span>{order.user.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {order.user.email}
                    </span>
                  </Link>
                ) : (
                  <span className="text-muted-foreground">аккаунт удалён</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatKopecks(order.amount)}
              </TableCell>
              <TableCell>
                <PaymentStatus status={order.status} refundedAt={null} />
                {order.status === "pending" && (
                  <Badge variant="outline" className="ml-2">
                    держит адрес
                  </Badge>
                )}
              </TableCell>
              <TableCell>{formatDateTime(order.createdAt)}</TableCell>
              <TableCell>{formatDateTime(order.paidAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager
        pathname="/slug-orders"
        params={params}
        page={page}
        total={total}
      />
    </>
  );
}
