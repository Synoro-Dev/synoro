"use client";

import type { DemoAccount } from "@synoro/auth/demo";
import { paths } from "@synoro/config";
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
} from "@synoro/ui";
import {
  CalendarCheckIcon,
  CalendarDaysIcon,
  CalendarSearchIcon,
  ChartNoAxesColumnIcon,
  Clock3Icon,
  ExternalLinkIcon,
  GlobeIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  MessageSquareTextIcon,
  PanelTopIcon,
  PlusIcon,
  SettingsIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type * as React from "react";

import { DemoSwitcher } from "./demo-switcher";
import { MobileTabBar } from "./mobile-tab-bar";
import { NavPlan } from "./nav-plan";
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
                <ExternalLinkIcon className="ml-auto size-3.5! opacity-50" />
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

/**
 * The practice's sections for the viewer's role. Daily work first, the
 * rarely touched setup below. Administrators see only what they may do —
 * never a page that would just say «the owner sets this».
 */
function practiceNav(practice: SidebarPractice, pathname: string) {
  const id = practice.practiceId;
  const owner = practice.role === "owner";
  const entry = (
    title: string,
    href: string,
    icon: LucideIcon,
    show = true,
  ): NavItem[] =>
    show ? [{ title, href, icon, active: pathname === href }] : [];

  const work = [
    ...entry("Сегодня", paths.booking.practice(id), LayoutDashboardIcon),
    ...entry("Календарь", paths.booking.calendar(id), CalendarDaysIcon),
    ...entry("Свободные окна", paths.booking.windows(id), CalendarSearchIcon),
    ...entry("Клиенты", paths.booking.clients(id), UsersIcon),
    ...entry("Оплаты", paths.booking.payments(id), WalletIcon),
    ...entry(
      "Аналитика",
      paths.booking.analytics(id),
      ChartNoAxesColumnIcon,
      owner,
    ),
  ];
  const setup = [
    ...entry("Страница записи", paths.booking.page(id), PanelTopIcon),
    ...entry("Рабочие часы", paths.booking.schedule(id), Clock3Icon),
    ...entry(
      "Сообщения клиентам",
      paths.booking.messages(id),
      MessageSquareTextIcon,
      owner,
    ),
    ...entry("Свой домен", paths.booking.domain(id), GlobeIcon, owner),
    {
      title: "Открыть страницу записи",
      href: paths.booking.public(practice.slug),
      icon: ExternalLinkIcon,
      active: false,
      external: true,
    },
  ];
  return { work, setup };
}

export function AppSidebar({
  user,
  practices,
  demoAccounts,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: { name: string; email: string; avatar: string };
  practices: SidebarPractice[];
  /** Demo stand only: the roles a visitor can switch between. */
  demoAccounts?: (DemoAccount & { key: string })[];
}) {
  const pathname = usePathname();
  const staffPractices = practices.filter((p) => p.role !== "client");
  const fromPath = PRACTICE_PATH.exec(pathname)?.[1];
  const current =
    staffPractices.find((p) => p.practiceId === fromPath) ?? staffPractices[0];
  const isClient = practices.some((p) => p.role === "client");
  // «Про» is the owner's plan: admins and clients don't pay for it.
  const isOwner = practices.some((p) => p.role === "owner");
  const nav = current ? practiceNav(current, pathname) : null;

  return (
    <>
      <Sidebar collapsible="icon" {...props}>
        <SidebarHeader>
          <PracticeSwitcher
            practices={staffPractices}
            current={current}
            isClient={isClient}
          />
        </SidebarHeader>
        <SidebarContent>
          {nav ? (
            <>
              <NavGroup label="Работа" items={nav.work} />
              <NavGroup label="Настройка практики" items={nav.setup} />
            </>
          ) : (
            <NavGroup
              label="Специалисту"
              items={[
                {
                  title: "Создать практику",
                  href: `${paths.booking.practices}?new=1`,
                  icon: PlusIcon,
                  active: false,
                },
              ]}
            />
          )}
          {isClient && (
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
          {demoAccounts && (
            <DemoSwitcher accounts={demoAccounts} email={user.email} />
          )}
        </SidebarContent>
        <SidebarFooter>
          {isOwner && <NavPlan />}
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
      {current && (
        <MobileTabBar practiceId={current.practiceId} pathname={pathname} />
      )}
    </>
  );
}
