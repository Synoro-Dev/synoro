"use client";

import { paths } from "@synoro/config";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@synoro/ui";
import { IconTile } from "@synoro/ui/reui/icon-tile";
import {
  CalendarCheckIcon,
  ChevronsUpDownIcon,
  LayoutGridIcon,
  PlusIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ROLE_LABELS, type SidebarPractice } from "./types";

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/**
 * Sections kept when switching practices: an administrator of several
 * specialists stays on the free windows (or calendar…) of the next one.
 */
const KEPT_SECTIONS = [
  paths.booking.windows,
  paths.booking.calendar,
  paths.booking.clients,
  paths.booking.schedule,
] as const;

/**
 * Workspace switcher (cal.com / dub.co style) for the practices one runs.
 * Practices one is a client of are not workspaces: they live in «Мои записи».
 */
export function PracticeSwitcher({
  practices,
  current,
  isClient,
}: {
  /** Practices the user runs (owner or administrator). */
  practices: SidebarPractice[];
  current: SidebarPractice | undefined;
  isClient: boolean;
}) {
  const { isMobile } = useSidebar();
  const pathname = usePathname();
  const section = current
    ? KEPT_SECTIONS.find((page) => page(current.practiceId) === pathname)
    : undefined;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent"
              />
            }
          >
            <IconTile variant="solid" size="sm" aria-hidden="true">
              {current ? initial(current.name) : <LayoutGridIcon />}
            </IconTile>
            <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate font-semibold">
                {current?.name ?? "Synoro"}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {current
                  ? [ROLE_LABELS[current.role], current.siteDomain?.hostname]
                      .filter(Boolean)
                      .join(" · ")
                  : "Выберите практику"}
              </span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-3.5! opacity-60 group-data-[collapsible=icon]:hidden" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-60"
            side={isMobile ? "bottom" : "right"}
            align="start"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>Практики</DropdownMenuLabel>
              {practices.map((p) => (
                <DropdownMenuItem
                  key={p.practiceId}
                  render={
                    <Link
                      href={(section ?? paths.booking.practice)(p.practiceId)}
                    />
                  }
                  aria-current={
                    p.practiceId === current?.practiceId ? "true" : undefined
                  }
                >
                  <IconTile size="xs" aria-hidden="true">
                    {initial(p.name)}
                  </IconTile>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {ROLE_LABELS[p.role]}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            {practices.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              {isClient && (
                <DropdownMenuItem render={<Link href={paths.booking.mine} />}>
                  <CalendarCheckIcon />
                  Мои записи
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                render={<Link href={paths.booking.practices} />}
              >
                <LayoutGridIcon />
                Все практики
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href={{
                      pathname: paths.booking.practices,
                      query: { new: "1" },
                    }}
                  />
                }
              >
                <PlusIcon />
                Новая практика
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
