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
  useSidebar,
} from "@synoro/ui";
import {
  ArrowLeftIcon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  CalendarSearchIcon,
  ChartNoAxesColumnIcon,
  ExternalLinkIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  PlusIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type * as React from "react";
import { useEffect } from "react";

import {
  isPracticeSettingsPage,
  practiceSections,
} from "../settings/practice-sections";
import { accountSections } from "../settings/settings-sidebar";
import { CommandMenu } from "./command-menu";
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

function NavGroup({ label, items }: { label?: string; items: NavItem[] }) {
  return (
    <SidebarGroup>
      {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
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
 * rarely touched settings below, behind one entry: inside them the sidebar
 * lists `settings` instead. Administrators see only what they may do — never
 * a page that would just say «the owner sets this».
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
  const groups = practiceSections(id, owner);
  const sections = groups.flatMap((g) => g.sections);
  const open: NavItem = {
    title: "Открыть страницу записи",
    href: paths.booking.public(practice.slug),
    icon: ExternalLinkIcon,
    active: false,
    external: true,
  };
  const setup: NavItem[] = [
    {
      title: "Настройки практики",
      href: paths.booking.settings(id),
      icon: SlidersHorizontalIcon,
      active: false,
    },
    open,
  ];
  const settings = groups.map((group) => ({
    label: group.title,
    items: group.sections.map(({ title, href, icon }) => ({
      title,
      href,
      icon,
      active: pathname === href,
    })),
  }));
  // ⌘K finds each section by name, from anywhere in the console.
  const search = [
    ...work,
    ...setup.slice(0, 1),
    ...sections.map(({ title, href, icon }) => ({ title, href, icon })),
    open,
  ];
  return { work, setup, settings, search };
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
  const { setOpenMobile } = useSidebar();
  // A link tapped in the phone's sheet: the page it opened should be in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs per address.
  useEffect(() => setOpenMobile(false), [pathname, setOpenMobile]);
  const staffPractices = practices.filter((p) => p.role !== "client");
  const fromPath = PRACTICE_PATH.exec(pathname)?.[1];
  const current =
    staffPractices.find((p) => p.practiceId === fromPath) ?? staffPractices[0];
  const isClient = practices.some((p) => p.role === "client");
  // «Про» is the owner's plan: admins and clients don't pay for it.
  const isOwner = practices.some((p) => p.role === "owner");
  const nav = current ? practiceNav(current, pathname) : null;
  const inAccountSettings = pathname.startsWith(paths.settings.root);
  // Settings have sections of their own: they take the sidebar's place, so a
  // settings page has one navigation, not one beside another.
  const settingsNav = inAccountSettings
    ? [
        {
          label: "Настройки аккаунта",
          items: accountSections.map(({ title, href, icon }) => ({
            title,
            href,
            icon,
            active: pathname === href,
          })),
        },
      ]
    : nav && current && isPracticeSettingsPage(current.practiceId, pathname)
      ? nav.settings
      : null;

  return (
    <>
      <Sidebar collapsible="icon" {...props}>
        <SidebarHeader>
          <PracticeSwitcher
            practices={staffPractices}
            current={current}
            isClient={isClient}
          />
          {nav && current && (
            <CommandMenu
              practiceId={current.practiceId}
              items={[
                ...nav.search,
                {
                  title: "Настройки аккаунта",
                  href: paths.settings.root,
                  icon: SettingsIcon,
                },
              ]}
            />
          )}
        </SidebarHeader>
        <SidebarContent>
          {settingsNav ? (
            <>
              <NavGroup
                items={[
                  {
                    title: "На главную",
                    href: current
                      ? paths.booking.practice(current.practiceId)
                      : paths.dashboard.root,
                    icon: ArrowLeftIcon,
                    active: false,
                  },
                ]}
              />
              {settingsNav.map((group) => (
                <NavGroup key={group.label} {...group} />
              ))}
            </>
          ) : nav ? (
            <>
              <NavGroup label="Работа" items={nav.work} />
              <NavGroup label="Практика" items={nav.setup} />
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
          {isClient && !settingsNav && (
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
          {!inAccountSettings && (
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Настройки аккаунта"
                  render={<Link href={paths.settings.root} />}
                >
                  <SettingsIcon />
                  <span>Настройки аккаунта</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          )}
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
