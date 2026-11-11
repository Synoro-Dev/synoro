import { Button } from "@synoro/ui";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireAdmin } from "~/auth/server";
import { Pager, SearchForm } from "~/components/list-toolbar";
import { PageHeader } from "~/components/page-header";
import { SignInTable } from "~/components/sign-in-table";
import { TableSkeleton } from "~/components/table-skeleton";
import { listHref, listParams, type SearchParams } from "~/lib/list-params";
import { api } from "~/orpc/server";

export const metadata: Metadata = { title: "Входы" };

const SOURCES = [
  { value: undefined, label: "Все" },
  { value: "ad", label: "Реклама" },
  { value: "referral", label: "С других сайтов" },
  { value: "direct", label: "Напрямую" },
] as const;

type Source = Exclude<(typeof SOURCES)[number]["value"], undefined>;

const isSource = (value: string | undefined): value is Source =>
  SOURCES.some((source) => source.value && source.value === value);

export default function SignInsPage(props: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader title="Входы" />
      <div className="flex flex-col gap-4 p-4">
        <Suspense fallback={<TableSkeleton />}>
          <SignIns searchParams={props.searchParams} />
        </Suspense>
      </div>
    </>
  );
}

async function SignIns({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const { params, page, input, first } = await listParams(searchParams);
  const requested = first(params.source);
  const source = isSource(requested) ? requested : undefined;
  // A user's full history (the link on their card); ids are short strings.
  const userId = first(params.userId)?.trim().slice(0, 100) || undefined;
  const { items, total } = await api.signIns.list({
    ...input,
    source,
    userId,
  });
  const owner = userId ? items[0] : undefined;

  return (
    <>
      {userId && (
        <p className="text-muted-foreground text-sm">
          Входы пользователя{" "}
          <Link
            href={`/users/${encodeURIComponent(userId)}` as Route}
            className="text-foreground hover:underline"
          >
            {owner ? `${owner.userName} (${owner.userEmail})` : userId}
          </Link>
          {" · "}
          <Link
            href={
              listHref("/sign-ins", params, {
                userId: undefined,
                page: undefined,
              }) as Route
            }
            className="hover:underline"
          >
            показать всех
          </Link>
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchForm
          action="/sign-ins"
          query={input.query}
          placeholder="Имя, почта, IP или город"
        >
          {source && <input type="hidden" name="source" value={source} />}
          {userId && <input type="hidden" name="userId" value={userId} />}
        </SearchForm>
        <div className="flex flex-wrap gap-1">
          {SOURCES.map((option) => (
            <Button
              key={option.label}
              size="sm"
              variant={option.value === source ? "secondary" : "ghost"}
              render={
                <Link
                  href={
                    listHref("/sign-ins", params, {
                      source: option.value,
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
      <SignInTable items={items} />
      <Pager pathname="/sign-ins" params={params} page={page} total={total} />
    </>
  );
}
