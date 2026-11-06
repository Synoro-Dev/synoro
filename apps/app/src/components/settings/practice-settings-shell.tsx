import { paths } from "@synoro/config";
import type { Profession } from "@synoro/validators";
import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { TermsProvider } from "../booking/terms";
import { SiteHeader } from "../layout";

/**
 * One section of the practice's settings: the header with the way back. Keeps
 * each section at its own address; the main sidebar lists the sections.
 */
export function PracticeSettingsShell({
  practice,
  title,
  children,
}: {
  practice: {
    id: string;
    profession: Profession;
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
      <main className="flex min-w-0 flex-col gap-6 p-4 lg:p-6">
        {/* From `md` the header's breadcrumb leads back. */}
        <Link
          href={settings}
          className="-my-1 flex min-h-11 w-fit items-center gap-1 text-sm text-muted-foreground md:hidden"
        >
          <ChevronLeftIcon className="size-4" aria-hidden="true" />
          Все настройки
        </Link>
        {children}
      </main>
    </TermsProvider>
  );
}
