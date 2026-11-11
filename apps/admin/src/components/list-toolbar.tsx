import { Button, Input } from "@synoro/ui";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import type { Route } from "next";
import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";

import { listHref, PAGE_SIZE } from "~/lib/list-params";

/** A GET form: the filter lives in the URL, so lists are linkable. */
export function SearchForm({
  action,
  query,
  placeholder,
  children,
}: {
  action: Route;
  query: string | undefined;
  placeholder: string;
  /** Extra fields kept on submit, e.g. a status select. */
  children?: ReactNode;
}) {
  return (
    <Form action={action} className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-80">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          type="search"
          name="q"
          defaultValue={query}
          placeholder={placeholder}
          aria-label={placeholder}
          className="pl-8"
        />
      </div>
      {children}
      <Button type="submit" variant="outline">
        Найти
      </Button>
    </Form>
  );
}

export function Pager({
  pathname,
  params,
  page,
  total,
}: {
  pathname: string;
  params: Record<string, string | string[] | undefined>;
  page: number;
  total: number;
}) {
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const hasPrev = page > 1;
  const hasNext = to < total;
  const href = (target: number) =>
    listHref(pathname, params, {
      page: target > 1 ? String(target) : undefined,
    }) as Route;

  return (
    <div className="text-muted-foreground flex items-center justify-between gap-2 text-sm">
      <span>
        {from}–{to} из {total}
      </span>
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="icon"
          disabled={!hasPrev}
          aria-label="Назад"
          render={hasPrev ? <Link href={href(page - 1)} /> : undefined}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={!hasNext}
          aria-label="Вперёд"
          render={hasNext ? <Link href={href(page + 1)} /> : undefined}
        >
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  );
}
