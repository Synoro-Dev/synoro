"use client";

import { paths } from "@synoro/config";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@synoro/ui";
import { BriefcaseIcon, ContactIcon, LogOutIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { authClient } from "~/auth/client";
import { resetAnalytics } from "~/lib/analytics";
import { ThemeMenuItems } from "../theme-menu";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** The client's profile menu: contacts, the look, the way out. */
export function ClientMenu({
  user,
  consoleHref,
  demoAccounts,
}: {
  user: { name: string; email: string; avatar: string };
  /** The console of a practice the user also runs, if any. */
  consoleHref: Route | null;
  /** Demo stand only: the roles a visitor can switch between. */
  demoAccounts?: { key: string; label: string }[];
}) {
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    resetAnalytics();
    router.push(paths.auth.login);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label="Профиль"
          />
        }
      >
        <Avatar className="size-8">
          <AvatarImage src={user.avatar} alt="" />
          <AvatarFallback className="text-xs font-medium">
            {initials(user.name)}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col font-normal">
            <span className="truncate text-sm font-medium text-foreground">
              {user.name}
            </span>
            <span className="truncate text-xs">{user.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem render={<a href="#contacts" />}>
            <ContactIcon />
            Телефон и уведомления
          </DropdownMenuItem>
          {consoleHref && (
            <DropdownMenuItem render={<Link href={consoleHref} />}>
              <BriefcaseIcon />
              Кабинет специалиста
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        {demoAccounts && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Демо: войти как</DropdownMenuLabel>
              {demoAccounts.map((account) => (
                // A route handler that sets the cookie: never prefetched.
                <DropdownMenuItem
                  key={account.key}
                  render={<a href={`/auth/demo?as=${account.key}`} />}
                >
                  {account.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <ThemeMenuItems />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>
          <LogOutIcon />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
