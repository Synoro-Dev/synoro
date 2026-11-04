"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@synoro/ui";
import {
  LayoutDashboardIcon,
  LogInIcon,
  type LucideIcon,
  ShieldIcon,
  StoreIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOut } from "./sign-out";

const NAV: { title: string; href: Route; icon: LucideIcon }[] = [
  { title: "Обзор", href: "/", icon: LayoutDashboardIcon },
  { title: "Пользователи", href: "/users", icon: UsersIcon },
  { title: "Практики", href: "/practices", icon: StoreIcon },
  { title: "Платежи «Про»", href: "/payments", icon: WalletIcon },
  { title: "Входы", href: "/sign-ins", icon: LogInIcon },
];

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);

export function AdminSidebar({ email }: { email: string }) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <ShieldIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">Synoro</span>
                <span className="text-muted-foreground truncate text-xs">
                  Админка
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {NAV.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  tooltip={item.title}
                  isActive={isActive(pathname, item.href)}
                  render={<Link href={item.href} />}
                >
                  <item.icon />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SignOut email={email} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
