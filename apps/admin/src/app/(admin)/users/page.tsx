import {
  Badge,
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

export const metadata: Metadata = { title: "Пользователи" };

/** Practices named in a row; the rest are behind the user's card. */
const MAX_PRACTICES = 3;

export default function UsersPage(props: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader title="Пользователи" />
      <div className="flex flex-col gap-4 p-4">
        <Suspense fallback={<TableSkeleton />}>
          <Users searchParams={props.searchParams} />
        </Suspense>
      </div>
    </>
  );
}

async function Users({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const { params, page, input } = await listParams(searchParams);
  const { items, total } = await api.users.list(input);

  return (
    <>
      <SearchForm
        action="/users"
        query={input.query}
        placeholder="Имя, почта или телефон"
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Пользователь</TableHead>
            <TableHead>Телефон</TableHead>
            <TableHead>Тариф</TableHead>
            <TableHead>Практики</TableHead>
            <TableHead>Регистрация</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={5}
                className="text-muted-foreground h-24 text-center"
              >
                Никого не нашли
              </TableCell>
            </TableRow>
          )}
          {items.map((user) => (
            <TableRow key={user.id}>
              <TableCell>
                <Link
                  href={`/users/${user.id}` as Route}
                  className="flex flex-col hover:underline"
                >
                  <span className="flex items-center gap-2 font-medium">
                    {user.name}
                    {user.role?.includes("admin") && (
                      <Badge variant="secondary">админ</Badge>
                    )}
                    {user.banned && <Badge variant="destructive">бан</Badge>}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {user.email}
                  </span>
                </Link>
              </TableCell>
              <TableCell className="tabular-nums">
                {user.phone ?? "—"}
              </TableCell>
              <TableCell>
                <PlanBadge plan={user.plan} />
              </TableCell>
              <TableCell>
                {user.practiceList.length === 0 && (
                  <span className="text-muted-foreground">—</span>
                )}
                <div className="flex flex-col">
                  {user.practiceList.slice(0, MAX_PRACTICES).map((practice) => (
                    <a
                      key={practice.slug}
                      href={bookingPageUrl(practice.slug)}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {practice.name}
                      <span className="text-muted-foreground text-xs">
                        {" "}
                        /{practice.slug}
                      </span>
                    </a>
                  ))}
                  {user.practices > MAX_PRACTICES && (
                    <Link
                      href={`/users/${user.id}` as Route}
                      className="text-muted-foreground text-xs hover:underline"
                    >
                      и ещё {user.practices - MAX_PRACTICES}
                    </Link>
                  )}
                </div>
              </TableCell>
              <TableCell>{formatDate(user.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pager pathname="/users" params={params} page={page} total={total} />
    </>
  );
}
