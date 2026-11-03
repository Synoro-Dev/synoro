import {
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
import { PlanBadge } from "~/components/plan-badge";
import { TableSkeleton } from "~/components/table-skeleton";
import { formatDate } from "~/lib/format";
import { bookingPageUrl } from "~/lib/links";
import { listParams, type SearchParams } from "~/lib/list-params";
import { api } from "~/orpc/server";

export const metadata: Metadata = { title: "Практики" };

export default function PracticesPage(props: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader title="Практики" />
      <div className="flex flex-col gap-4 p-4">
        <Suspense fallback={<TableSkeleton />}>
          <Practices searchParams={props.searchParams} />
        </Suspense>
      </div>
    </>
  );
}

async function Practices({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const { params, page, input } = await listParams(searchParams);
  const { items, total } = await api.practices.list(input);

  return (
    <>
      <SearchForm
        action="/practices"
        query={input.query}
        placeholder="Название, адрес или почта владельца"
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Практика</TableHead>
            <TableHead>Владелец</TableHead>
            <TableHead>Тариф</TableHead>
            <TableHead className="text-right">Клиентов</TableHead>
            <TableHead className="text-right">Записей за 30 дней</TableHead>
            <TableHead>Создана</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="text-muted-foreground h-24 text-center"
              >
                Ничего не нашли
              </TableCell>
            </TableRow>
          )}
          {items.map((practice) => (
            <TableRow key={practice.id}>
              <TableCell>
                <a
                  href={bookingPageUrl(practice.slug)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-col hover:underline"
                >
                  <span className="font-medium">{practice.name}</span>
                  <span className="text-muted-foreground text-xs">
                    /p/{practice.slug}
                  </span>
                </a>
              </TableCell>
              <TableCell>
                <Link
                  href={`/users/${practice.owner.id}` as Route}
                  className="flex flex-col hover:underline"
                >
                  <span>{practice.owner.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {practice.owner.email}
                  </span>
                </Link>
              </TableCell>
              <TableCell>
                <PlanBadge plan={practice.plan} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {practice.clients}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {practice.bookings}
              </TableCell>
              <TableCell>{formatDate(practice.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager pathname="/practices" params={params} page={page} total={total} />
    </>
  );
}
