"use client";

import { paths } from "@acme/config";
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
} from "@acme/ui";
import { IconTile } from "@acme/ui/reui/icon-tile";
import { ChevronsUpDownIcon, LayoutGridIcon, PlusIcon } from "lucide-react";
import Link from "next/link";

import { ROLE_LABELS, type SidebarPractice } from "./types";

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/** Workspace switcher (cal.com / dub.co style) for the practices one runs. */
export function PracticeSwitcher({
  practices,
  current,
}: {
  practices: SidebarPractice[];
  current: SidebarPractice | undefined;
}) {
  const { isMobile } = useSidebar();

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
            <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">
                {current?.name ?? "Синоро"}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {current ? ROLE_LABELS[current.role] : "Выберите практику"}
              </span>
            </div>
            <ChevronsUpDownIcon className="ml-auto" />
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
                      href={
                        p.role === "client"
                          ? paths.booking.public(p.slug)
                          : paths.booking.practice(p.practiceId)
                      }
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
