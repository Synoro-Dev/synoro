"use client";

import { paths } from "@synoro/config";
import { cn, useSidebar } from "@synoro/ui";
import {
  CalendarDaysIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  MenuIcon,
  UsersIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

const TAB =
  "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium text-muted-foreground outline-none transition-colors focus-visible:bg-muted aria-[current=page]:text-brand-foreground [&_svg]:size-5";

/**
 * Phones get the three daily places one thumb away; everything else is
 * behind «Ещё» (the sidebar sheet). Hidden from `md` up, where the sidebar
 * is always on screen.
 */
export function MobileTabBar({
  practiceId,
  pathname,
}: {
  practiceId: string;
  pathname: string;
}) {
  const { setOpenMobile } = useSidebar();
  const tabs: { title: string; href: string; icon: LucideIcon }[] = [
    {
      title: "Сегодня",
      href: paths.booking.practice(practiceId),
      icon: LayoutDashboardIcon,
    },
    {
      title: "Календарь",
      href: paths.booking.calendar(practiceId),
      icon: CalendarDaysIcon,
    },
    {
      title: "Клиенты",
      href: paths.booking.clients(practiceId),
      icon: UsersIcon,
    },
  ];

  return (
    <nav
      aria-label="Основные разделы"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href as Route}
          aria-current={pathname === tab.href ? "page" : undefined}
          className={TAB}
        >
          <tab.icon aria-hidden="true" />
          {tab.title}
        </Link>
      ))}
      <button
        type="button"
        className={cn(TAB)}
        onClick={() => setOpenMobile(true)}
      >
        <MenuIcon aria-hidden="true" />
        Ещё
      </button>
    </nav>
  );
}
