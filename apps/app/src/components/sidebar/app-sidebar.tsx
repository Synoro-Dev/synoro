"use client";

import { paths } from "@acme/config";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@acme/ui";
import {
  CalendarCheckIcon,
  CalendarDaysIcon,
  Clock3Icon,
  ExternalLinkIcon,
  GlobeIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  PlusIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type * as React from "react";

import { NavUser } from "./nav-user";
import { PracticeSwitcher } from "./practice-switcher";
import type { SidebarPractice } from "./types";

const PRACTICE_PATH = /^\/practices\/([0-9a-f-]{36})(?:\/|$)/;

interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  active: boolean;
  external?: boolean;
}

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.title}>
            <SidebarMenuButton
              tooltip={item.title}
              isActive={item.active}
              render={
                <Link
                  href={item.href as Route}
                  target={item.external ? "_blank" : undefined}
                />
              }
            >
              <item.icon />
              <span>{item.title}</span>
              {item.external && (
                <ExternalLinkIcon className="ml-auto opacity-50" />
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

export function AppSidebar({
  user,
  practices,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: { name: string; email: string; avatar: string };
  practices: SidebarPractice[];
}) {
  const pathname = usePathname();
  const staffPractices = practices.filter((p) => p.role !== "client");
  const fromPath = PRACTICE_PATH.exec(pathname)?.[1];
  const current =
    staffPractices.find((p) => p.practiceId === fromPath) ?? staffPractices[0];
  const isClient = practices.some((p) => p.role === "client");

  const practiceItems: NavItem[] = current
    ? [
        {
          title: "Обзор",
          href: paths.booking.practice(current.practiceId),
          icon: LayoutDashboardIcon,
          active: pathname === paths.booking.practice(current.practiceId),
        },
        {
          title: "Календарь",
          href: paths.booking.calendar(current.practiceId),
          icon: CalendarDaysIcon,
          active: pathname === paths.booking.calendar(current.practiceId),
        },
        {
          title: "Клиенты",
          href: paths.booking.clients(current.practiceId),
          icon: UsersIcon,
          active: pathname === paths.booking.clients(current.practiceId),
        },
        {
          title: "Расписание",
          href: paths.booking.schedule(current.practiceId),
          icon: Clock3Icon,
          active: pathname === paths.booking.schedule(current.practiceId),
        },
        {
          title: "Домен",
          href: paths.booking.domain(current.practiceId),
          icon: GlobeIcon,
          active: pathname === paths.booking.domain(current.practiceId),
        },
        {
          title: "Страница записи",
          href: paths.booking.public(current.slug),
          icon: ExternalLinkIcon,
          active: false,
          external: true,
        },
      ]
    : [
        {
          title: "Создать практику",
          href: `${paths.booking.practices}?new=1`,
          icon: PlusIcon,
          active: false,
        },
      ];

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <PracticeSwitcher practices={practices} current={current} />
      </SidebarHeader>
      <SidebarContent>
        <NavGroup
          label={current ? "Практика" : "Специалисту"}
          items={practiceItems}
        />
        {(isClient || !current) && (
          <NavGroup
            label="Я клиент"
            items={[
              {
                title: "Мои записи",
                href: paths.booking.mine,
                icon: CalendarCheckIcon,
                active: pathname === paths.booking.mine,
              },
            ]}
          />
        )}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Настройки"
              isActive={pathname.startsWith(paths.settings.root)}
              render={<Link href={paths.settings.root} />}
            >
              <SettingsIcon />
              <span>Настройки</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
