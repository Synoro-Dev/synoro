"use client";

import { paths } from "@synoro/config";
import {
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@synoro/ui";
import { formatPhone } from "@synoro/validators";
import { useQuery } from "@tanstack/react-query";
import { type LucideIcon, SearchIcon, UserIcon } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { orpc } from "~/orpc/react";
import { matchClients } from "../booking/client-search";

export interface CommandItem {
  title: string;
  href: string;
  icon: LucideIcon;
  external?: boolean;
}

interface Option {
  id: string;
  group: "Разделы" | "Клиенты";
  title: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
}

/** ⌘K on a Mac, Ctrl+K elsewhere. */
function shortcutLabel() {
  if (typeof navigator === "undefined") return "Ctrl K";
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";
}

/**
 * Search and jump, from the keyboard: ⌘K / Ctrl+K opens it anywhere in the
 * console. Finds the practice's sections and its clients (a client opens on
 * their card). Only what the viewer's role may open is listed.
 */
export function CommandMenu({
  practiceId,
  items,
}: {
  practiceId: string;
  items: CommandItem[];
}) {
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [shortcut, setShortcut] = useState("Ctrl K");

  useEffect(() => {
    setShortcut(shortcutLabel());
    const onKey = (event: KeyboardEvent) => {
      if (
        // The physical K: on a Russian layout `key` is «л».
        (event.code === "KeyK" || event.key.toLowerCase() === "k") &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey
      ) {
        event.preventDefault();
        setOpen((was) => !was);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const members = useQuery({
    ...orpc.practice.members.queryOptions({ input: { practiceId } }),
    enabled: open,
  });
  const clients = (members.data ?? []).filter((m) => m.role === "client");

  function go(href: string, external?: boolean) {
    setOpen(false);
    setQuery("");
    if (external) window.open(href, "_blank", "noopener");
    else router.push(href as Route);
  }

  const q = query.trim().toLowerCase();
  const options: Option[] = [
    ...items
      .filter((item) => !q || item.title.toLowerCase().includes(q))
      .map((item) => ({
        id: `nav-${item.href}`,
        group: "Разделы" as const,
        title: item.title,
        icon: item.icon,
        run: () => go(item.href, item.external),
      })),
    ...(q
      ? matchClients(clients, query)
          .slice(0, 8)
          .map((m) => ({
            id: `client-${m.id}`,
            group: "Клиенты" as const,
            title: m.name,
            hint: m.phone ? formatPhone(m.phone) : m.email,
            icon: UserIcon,
            run: () =>
              go(`${paths.booking.clients(practiceId)}?client=${m.id}`),
          }))
      : []),
  ];
  const current = Math.min(active, Math.max(options.length - 1, 0));

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current + 1) % Math.max(options.length, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current - 1 + options.length) % Math.max(options.length, 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      options[current]?.run();
    }
  }

  return (
    <>
      <SidebarMenu className="max-md:hidden">
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={`Поиск (${shortcut})`}
            onClick={() => setOpen(true)}
            className="text-muted-foreground"
          >
            <SearchIcon />
            <span>Поиск</span>
            <kbd className="ml-auto rounded border bg-background px-1.5 font-sans text-xs group-data-[collapsible=icon]:hidden">
              {shortcut}
            </kbd>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <DialogContent className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogTitle className="sr-only">Поиск</DialogTitle>
          <DialogDescription className="sr-only">
            Разделы практики и клиенты. Стрелки выбирают, Enter открывает.
          </DialogDescription>
          <div className="flex items-center gap-2 border-b px-3">
            <SearchIcon
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <input
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={options[current]?.id}
              aria-label="Раздел или имя клиента"
              placeholder="Раздел или имя клиента"
              className="h-12 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label="Результаты"
            className="max-h-80 overflow-y-auto p-1.5"
          >
            {options.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {members.isPending && q ? "Ищем…" : "Ничего не нашли"}
              </p>
            ) : (
              options.map((option, index) => (
                <div key={option.id}>
                  {option.group !== options[index - 1]?.group && (
                    <div
                      role="presentation"
                      className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                    >
                      {option.group}
                    </div>
                  )}
                  <div
                    id={option.id}
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === current}
                    onMouseMove={() => setActive(index)}
                    onClick={option.run}
                    onKeyDown={onKeyDown}
                    className={cn(
                      "flex min-h-10 cursor-default items-center gap-3 rounded-md px-2 text-sm",
                      index === current && "bg-muted",
                    )}
                  >
                    <option.icon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {option.title}
                    </span>
                    {option.hint && (
                      <span className="truncate text-xs text-muted-foreground tabular-nums">
                        {option.hint}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
