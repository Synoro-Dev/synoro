"use client";

import { buttonVariants, cn } from "@synoro/ui";
import { ArrowRightIcon, MenuIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { SiteLinks } from "~/lib/site";

import { Logo } from "./logo";

/** `wide`: shown in the top bar only where there is room; the menu has all. */
const nav: { href: string; label: string; wide?: true }[] = [
  { href: "#features", label: "Возможности" },
  { href: "#domain", label: "Свой адрес", wide: true },
  { href: "#embed", label: "На вашем сайте" },
  { href: "#how", label: "Как начать" },
  { href: "#pricing", label: "Тарифы" },
  { href: "#faq", label: "Вопросы" },
];

/** Where the top bar gives way to the menu button (Tailwind's `md`). */
const desktop = "(min-width: 48rem)";

/**
 * The landing's top bar; below `md` its links fold into a full-screen menu.
 * `domain`: whether the page has the «Свой адрес» section to link to.
 */
export function Header({
  links,
  domain = true,
}: {
  links: SiteLinks;
  domain?: boolean;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = domain ? nav : nav.filter((item) => item.href !== "#domain");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // While the menu is open the page under it stays put and out of reach of
  // Tab, Escape closes it, and growing past `md` (a phone turned sideways)
  // puts the top bar back. A page restored from the back/forward cache after
  // leaving through the menu (sign-up, sign-in) comes back with it closed.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    const behind = [...document.body.children].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element !== header.current &&
        !element.inert,
    );
    for (const element of behind) element.inert = true;
    const onShow = (event: PageTransitionEvent) =>
      event.persisted && setOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const wide = window.matchMedia(desktop);
    const onWide = () => wide.matches && setOpen(false);
    document.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    window.addEventListener("pageshow", onShow);
    return () => {
      root.style.overflow = overflow;
      for (const element of behind) element.inert = false;
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
      window.removeEventListener("pageshow", onShow);
    };
  }, [open]);

  return (
    <header
      ref={header}
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b transition-colors duration-200",
        open
          ? "bg-background border-border"
          : scrolled
            ? "bg-background/80 border-border backdrop-blur-xl"
            : "border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-8 px-4 sm:px-6">
        <a href="/" aria-label="На главную" onClick={() => setOpen(false)}>
          <Logo />
        </a>

        <nav className="hidden items-center gap-1 md:flex">
          {items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={cn(
                "text-muted-foreground hover:text-foreground hover:bg-muted rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                item.wide && "hidden lg:block",
              )}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          {links.demo && (
            <a
              href={links.demo}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "rounded-full px-4",
              )}
            >
              Посмотреть пример
            </a>
          )}
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

        <div className="ml-auto flex items-center gap-1 md:hidden">
          <a
            href={links.login}
            className={cn(
              buttonVariants({ variant: "ghost", size: "lg" }),
              "rounded-full px-4",
            )}
          >
            Войти
          </a>
          <button
            ref={button}
            type="button"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon-lg" }),
              "-mr-2 rounded-full",
            )}
            aria-label={open ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? (
              <XIcon className="size-5" />
            ) : (
              <MenuIcon className="size-5" />
            )}
          </button>
        </div>
      </div>

      {open && (
        <div
          id="mobile-menu"
          className="bg-background absolute inset-x-0 top-full flex h-[calc(100dvh-4rem)] animate-in flex-col overflow-y-auto overscroll-contain px-4 duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] fade-in-0 slide-in-from-top-2 sm:px-6 md:hidden"
        >
          <nav aria-label="Разделы" className="flex flex-col pt-2">
            {items.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="active:bg-muted -mx-2 flex items-center justify-between rounded-lg border-b px-2 py-4 text-lg font-medium tracking-tight transition-colors"
              >
                {item.label}
                <ArrowRightIcon className="text-muted-foreground size-4" />
              </a>
            ))}
          </nav>

          <div className="mt-auto flex flex-col gap-2 pt-8 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <a
              href={links.signup}
              className={cn(
                buttonVariants({ size: "lg" }),
                "h-12 rounded-full text-base",
              )}
            >
              Начать бесплатно
            </a>
            {links.demo && (
              <a
                href={links.demo}
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "h-12 rounded-full text-base",
                )}
              >
                Посмотреть пример
              </a>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
