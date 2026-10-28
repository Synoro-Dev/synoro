import { cn } from "@synoro/ui";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface ErrorScreenProps {
  /** Крупный код на фоне: «404», «500». */
  code: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Кнопки действий. */
  children?: ReactNode;
  /** Мелкий текст под кнопками, например ID ошибки. */
  footnote?: ReactNode;
  /**
   * `page` занимает весь экран (корневые страницы), `inline` встаёт внутрь
   * уже отрисованной оболочки кабинета.
   */
  variant?: "page" | "inline";
}

/**
 * Общий экран ошибки: 404, 500 и остальные. Без клиентского кода, поэтому
 * годится и для серверных страниц, и для границ ошибок.
 */
export function ErrorScreen({
  code,
  title,
  description,
  icon: Icon,
  children,
  footnote,
  variant = "page",
}: ErrorScreenProps) {
  return (
    <div
      className={cn(
        "relative isolate flex flex-col items-center justify-center overflow-hidden px-6 py-16",
        variant === "page" ? "min-h-svh" : "min-h-[70svh] flex-1",
      )}
    >
      {/* Сетка, плавно растворяющаяся к краям */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:48px_48px] opacity-60 [mask-image:radial-gradient(ellipse_60%_55%_at_50%_45%,black,transparent)]"
      />
      {/* Мягкое свечение за цифрами */}
      <div
        aria-hidden
        className="bg-primary/10 absolute top-1/2 left-1/2 -z-10 size-[28rem] max-w-full -translate-x-1/2 -translate-y-[60%] rounded-full blur-3xl"
      />

      <div className="animate-in fade-in slide-in-from-bottom-4 flex max-w-md flex-col items-center text-center duration-500 motion-reduce:animate-none">
        <div className="relative">
          <span
            aria-hidden
            className="from-foreground to-foreground/5 block bg-gradient-to-b bg-clip-text text-[7rem] leading-none font-bold tracking-tighter text-transparent select-none sm:text-[10rem]"
          >
            {code}
          </span>
          <div className="bg-background absolute top-1/2 left-1/2 flex size-[5.25rem] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-3xl border shadow-lg sm:size-32">
            <Icon className="text-foreground size-9 sm:size-12" aria-hidden />
          </div>
        </div>

        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          <span className="sr-only">{code}. </span>
          {title}
        </h1>
        <p className="text-muted-foreground mt-3 text-sm text-pretty sm:text-base">
          {description}
        </p>

        {children && (
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {children}
          </div>
        )}
        {footnote && (
          <p className="text-muted-foreground/70 mt-6 font-mono text-xs">
            {footnote}
          </p>
        )}
      </div>
    </div>
  );
}
