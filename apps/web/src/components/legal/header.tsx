import { buttonVariants, cn } from "@synoro/ui";
import { ArrowLeftIcon } from "lucide-react";

import { Logo } from "~/components/landing/logo";
import type { SiteLinks } from "~/lib/site";

/** The landing's header without the section anchors, for the legal pages. */
export function LegalHeader({ links }: { links: SiteLinks }) {
  return (
    <header className="bg-background/80 fixed inset-x-0 top-0 z-50 border-b backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        <a href="/" aria-label="На главную">
          <Logo />
        </a>
        <a
          href="/"
          className="text-muted-foreground hover:text-foreground hidden items-center gap-1.5 text-sm transition-colors sm:flex"
        >
          <ArrowLeftIcon className="size-3.5" />
          На главную
        </a>
        <div className="ml-auto flex items-center gap-2">
          <a
            href={links.login}
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "rounded-full px-4",
            )}
          >
            Войти
          </a>
        </div>
      </div>
    </header>
  );
}
