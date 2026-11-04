"use client";

import { paths } from "@synoro/config";
import type { MemberRole } from "@synoro/db";
import { cn } from "@synoro/ui";
import type { Profession } from "@synoro/validators";
import { ChevronLeftIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { TermsProvider } from "../booking/terms";
import { SiteHeader } from "../layout";
import { practiceSections } from "./practice-sections";

/** The sections, beside the open one. Phones use the settings page instead. */
function SectionRail({
  practiceId,
  isOwner,
}: {
  practiceId: string;
  isOwner: boolean;
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Разделы настроек"
      className="sticky top-20 hidden w-48 shrink-0 flex-col gap-5 self-start lg:flex"
    >
      {practiceSections(practiceId, isOwner).map((group) => (
        <div key={group.title} className="flex flex-col gap-0.5">
          <span className="px-2 pb-1 text-xs font-medium text-muted-foreground">
            {group.title}
          </span>
          {group.sections.map((section) => (
            <Link
              key={section.href}
              href={section.href as Route}
              aria-current={pathname === section.href ? "page" : undefined}
              className={cn(
                "flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-muted aria-[current=page]:font-medium dark:hover:bg-muted/50",
              )}
            >
              <section.icon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="min-w-0 truncate">{section.title}</span>
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

/**
 * One section of the practice's settings: the header with the way back and
 * the rail of sections. Keeps each section at its own address.
 */
export function PracticeSettingsShell({
  practice,
  title,
  children,
}: {
  practice: {
    id: string;
    profession: Profession;
    membership: { role: MemberRole };
  };
  title: string;
  children: ReactNode;
}) {
  const settings = paths.booking.settings(practice.id);
  return (
    <TermsProvider profession={practice.profession}>
      <SiteHeader
        title={title}
        parent={{ label: "Настройки", href: settings }}
      />
      <main className="flex min-w-0 items-start gap-8 p-4 lg:p-6">
        <SectionRail
          practiceId={practice.id}
          isOwner={practice.membership.role === "owner"}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {/* From `md` the header's breadcrumb leads back. */}
          <Link
            href={settings}
            className="-my-1 flex min-h-11 w-fit items-center gap-1 text-sm text-muted-foreground md:hidden"
          >
            <ChevronLeftIcon className="size-4" aria-hidden="true" />
            Все настройки
          </Link>
          {children}
        </div>
      </main>
    </TermsProvider>
  );
}
