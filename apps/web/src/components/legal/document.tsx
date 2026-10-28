import { cn } from "@synoro/ui";

import { Container } from "~/components/landing/primitives";

const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** Page frame of one legal document: title, edition date, readable column. */
export function LegalPage({
  title,
  updatedAt,
  lead,
  children,
}: {
  title: string;
  /** ISO date of the edition. */
  updatedAt: string;
  lead?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="pt-16">
      <Container className="px-4 py-12 sm:px-10 sm:py-16">
        <article className="max-w-3xl">
          <h1 className="text-3xl font-medium tracking-tight text-balance sm:text-4xl">
            {title}
          </h1>
          <p className="text-muted-foreground mt-3 text-sm">
            Редакция от {dateFormat.format(new Date(updatedAt))}
          </p>
          {lead && (
            <div className="text-muted-foreground mt-6 space-y-3 text-base text-pretty">
              {lead}
            </div>
          )}
          <div className="mt-10 space-y-10">{children}</div>
        </article>
      </Container>
    </main>
  );
}

/** A numbered part of a document; its clauses are `Clause`s. */
export function Part({
  id,
  n,
  title,
  children,
}: {
  id: string;
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <h2 className="text-xl font-medium tracking-tight">
        {n}. {title}
      </h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-pretty">
        {children}
      </div>
    </section>
  );
}

/** A numbered clause (`1.1.`). Citations stay stable across editions. */
export function Clause({
  n,
  children,
}: {
  n: string;
  children: React.ReactNode;
}) {
  return (
    <p>
      <span className="text-muted-foreground mr-2 tabular-nums">{n}</span>
      {children}
    </p>
  );
}

/** Items under a clause. */
export function Items({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "marker:text-muted-foreground list-disc space-y-1.5 pl-9",
        className,
      )}
    >
      {children}
    </ul>
  );
}

export function Link({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground transition-colors"
    >
      {children}
    </a>
  );
}

/** Small table for plans, cookies and the like. Scrolls sideways on phones. */
export function DataTable({
  head,
  rows,
}: {
  head: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            {head.map((cell) => (
              <th key={cell} className="px-3 py-2 font-medium">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static rows
            <tr key={index} className="align-top">
              {row.map((cell, cellIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static cells
                <td key={cellIndex} className="px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
