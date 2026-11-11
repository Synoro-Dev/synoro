import { paths } from "@synoro/config";
import { Skeleton } from "@synoro/ui";
import { Frame, FramePanel } from "@synoro/ui/reui/frame";
import { IconTile } from "@synoro/ui/reui/icon-tile";
import { ChevronRightIcon, ListTodoIcon, type LucideIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { loadStaffPractice } from "~/components/booking/staff-practice";
import { PageHeading } from "~/components/booking/states";
import { TermsProvider } from "~/components/booking/terms";
import { SiteHeader } from "~/components/layout";
import { practiceSections } from "~/components/settings/practice-sections";

export default function PracticeSettingsPage({
  params,
}: PageProps<"/practices/[practiceId]/settings">) {
  return (
    <Suspense fallback={<Skeleton className="m-6 h-96 rounded-xl" />}>
      <Settings params={params} />
    </Suspense>
  );
}

function SectionRow({
  title,
  description,
  href,
  icon: Icon,
}: {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
}) {
  return (
    <FramePanel className="p-0">
      <Link
        href={href as Route}
        className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <IconTile variant="soft" aria-hidden="true">
          <Icon />
        </IconTile>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-sm text-muted-foreground">{description}</span>
        </span>
        <ChevronRightIcon
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
      </Link>
    </FramePanel>
  );
}

async function Settings({
  params,
}: Pick<PageProps<"/practices/[practiceId]/settings">, "params">) {
  const practice = await loadStaffPractice((await params).practiceId);
  const isOwner = practice.membership.role === "owner";
  return (
    <TermsProvider profession={practice.profession}>
      <SiteHeader
        title="Настройки"
        parent={{
          label: practice.name,
          href: paths.booking.practice(practice.id),
        }}
      />
      <main className="flex max-w-3xl min-w-0 flex-col gap-6 p-4 lg:p-6">
        <PageHeading title="Настройки практики" description={practice.name} />
        {practiceSections(practice.id, isOwner).map((group) => (
          <section key={group.title} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              {group.title}
            </h2>
            <Frame spacing="default" stacked>
              {group.sections.map((section) => (
                <SectionRow key={section.href} {...section} />
              ))}
            </Frame>
          </section>
        ))}
        {isOwner && (
          <Frame spacing="default" stacked>
            <SectionRow
              title="Первая настройка"
              description="Часы, цены, правила и ссылка — по шагам"
              href={paths.booking.setup(practice.id)}
              icon={ListTodoIcon}
            />
          </Frame>
        )}
      </main>
    </TermsProvider>
  );
}
