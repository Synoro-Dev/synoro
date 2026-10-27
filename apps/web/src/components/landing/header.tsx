"use client";

import { buttonVariants, cn } from "@synoro/ui";
import { MenuIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { SiteLinks } from "~/lib/site";

import { Logo } from "./logo";

const nav = [
  { href: "#features", label: "Возможности" },
  { href: "#domain", label: "Свой домен" },
  { href: "#how", label: "Как начать" },
  { href: "#pricing", label: "Тарифы" },
  { href: "#faq", label: "Вопросы" },
];

export function Header({ links }: { links: SiteLinks }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b transition-colors duration-200",
        scrolled || open
          ? "bg-background/80 border-border backdrop-blur-xl"
          : "border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-8 px-4 sm:px-6">
        <a href="#top" aria-label="На главную">
          <Logo />
        </a>

        <nav className="hidden items-center gap-1 md:flex">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-full px-3 py-1.5 text-sm transition-colors"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          <a
            href={links.login}
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "rounded-full px-4",
            )}
          >
            Войти
          </a>
          <a
            href={links.signup}
            className={cn(buttonVariants(), "rounded-full px-4")}
          >
            Начать бесплатно
          </a>
        </div>

        <button
          type="button"
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon" }),
            "ml-auto md:hidden",
          )}
          aria-label={open ? "Закрыть меню" : "Открыть меню"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <XIcon /> : <MenuIcon />}
        </button>
      </div>

      {open && (
        <div className="border-t px-4 pt-2 pb-6 md:hidden">
          <nav className="flex flex-col">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="border-b py-3 text-base"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="mt-6 grid grid-cols-2 gap-2">
            <a
              href={links.login}
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "rounded-full",
              )}
            >
              Войти
            </a>
            <a
              href={links.signup}
              className={cn(buttonVariants({ size: "lg" }), "rounded-full")}
            >
              Начать
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
