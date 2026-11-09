"use client";

import type { RouterOutputs } from "@synoro/api";
import { Button, cn, Spinner } from "@synoro/ui";
import { Badge } from "@synoro/ui/reui/badge";
import {
  CheckIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LockIcon,
  ShieldCheckIcon,
  WaypointsIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { CopyStateIcon, useCopied } from "../copy-value";

export type DomainStage = RouterOutputs["domain"]["verify"]["stage"];

const STEPS = [
  {
    stage: "ownership",
    icon: ShieldCheckIcon,
    title: "Подтверждаем, что домен ваш",
    done: "Владение подтверждено",
    hint: "Добавьте TXT-запись из таблицы ниже. Обычно она становится видна за 5–30 минут, иногда — до суток.",
  },
  {
    stage: "routing",
    icon: WaypointsIcon,
    title: "Ждём, когда домен поведёт на Synoro",
    done: "DNS ведёт на Synoro",
    hint: "Добавьте CNAME или ALIAS из таблицы ниже. Как только DNS обновится, мы сами закажем сертификат.",
  },
  {
    stage: "certificate",
    icon: LockIcon,
    title: "Выпускаем SSL-сертификат",
    done: "SSL-сертификат выпущен",
    hint: "Let’s Encrypt выпускает сертификат для https — обычно за 5–10 минут. Страницу можно закрыть: всё завершится без вас.",
  },
  {
    stage: "ready",
    icon: GlobeIcon,
    title: "Сайт готов",
    done: "Сайт готов",
    hint: "",
  },
] as const;

export const STAGE_BADGE = {
  ownership: { label: "Ожидает проверки", variant: "warning-light" },
  routing: { label: "Настройте DNS", variant: "warning-light" },
  certificate: { label: "Выпускаем SSL", variant: "info-light" },
  ready: { label: "Работает", variant: "success-light" },
} as const;

function StepIndicator({
  state,
  icon: Icon,
}: {
  state: "done" | "current" | "todo";
  icon: (typeof STEPS)[number]["icon"];
}) {
  if (state === "done") {
    return (
      <span
        // Remounts when the step completes, so the check pops in once.
        key="done"
        className="relative z-10 flex size-8 shrink-0 animate-in items-center justify-center rounded-full bg-success text-white duration-300 zoom-in-50 fade-in motion-reduce:animate-none"
      >
        <CheckIcon className="size-4" strokeWidth={3} aria-hidden />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span
        key="current"
        className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-background text-primary"
      >
        <span
          className="absolute inset-0 animate-ping rounded-full bg-primary/15 motion-reduce:animate-none"
          aria-hidden
        />
        <span
          className="absolute inset-0 rounded-full border-2 border-primary/15"
          aria-hidden
        />
        <span
          className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-primary [animation-duration:1.2s] motion-reduce:animate-none"
          aria-hidden
        />
        <Icon className="size-4" aria-hidden />
      </span>
    );
  }
  return (
    <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground">
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

/** How the page keeps checking by itself, shown under the current step. */
function BackgroundCheck({
  stage,
  stopped,
  checking,
  checkedAt,
  interval,
}: {
  stage: DomainStage;
  /** The checks stopped on an error: no countdown, no promise of more. */
  stopped: boolean;
  checking: boolean;
  /** `dataUpdatedAt` of the last check: restarts the countdown. */
  checkedAt: number;
  interval: number;
}) {
  if (stopped && !checking) {
    return (
      <span className="mt-3 text-xs text-muted-foreground">
        Автоматическая проверка остановлена
      </span>
    );
  }
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <div className="h-1 w-full max-w-64 overflow-hidden rounded-full bg-muted">
        {stage === "certificate" ? (
          <div className="h-full w-1/3 animate-sweep rounded-full bg-primary/70 motion-reduce:animate-none" />
        ) : (
          <div
            key={checkedAt}
            className="h-full origin-left animate-countdown rounded-full bg-primary/50 motion-reduce:animate-none"
            style={{ animationDuration: `${interval}ms` }}
          />
        )}
      </div>
      <span
        className="flex items-center gap-1.5 text-xs text-muted-foreground"
        aria-live="polite"
      >
        {checking ? (
          <>
            <Spinner className="size-3" aria-hidden />
            {stage === "certificate" ? "Проверяем https…" : "Проверяем DNS…"}
          </>
        ) : (
          `Проверяем автоматически каждые ${Math.round(interval / 1000)} с — обновлять страницу не нужно`
        )}
      </span>
    </div>
  );
}

/**
 * The connection's steps as a vertical timeline: done steps get a check and
 * fill the line to the next one, the current one spins while the page checks
 * DNS (and then https) in the background.
 */
export function DomainProgress({
  stage,
  stopped,
  checking,
  checkedAt,
  interval,
  children,
}: {
  stage: DomainStage;
  stopped: boolean;
  checking: boolean;
  checkedAt: number;
  interval: number;
  /** Shown under the current step, e.g. the records to add. */
  children?: ReactNode;
}) {
  const current = STEPS.findIndex((step) => step.stage === stage);
  return (
    <ol className="flex flex-col">
      {STEPS.map((step, index) => {
        const state =
          index < current || stage === "ready"
            ? "done"
            : index === current
              ? "current"
              : "todo";
        const last = index === STEPS.length - 1;
        return (
          <li
            key={step.stage}
            className={cn("relative flex gap-3", !last && "pb-6")}
            aria-current={state === "current" ? "step" : undefined}
          >
            {!last && (
              <span
                className="absolute top-9 bottom-1 left-4 w-0.5 -translate-x-1/2 overflow-hidden rounded-full bg-border"
                aria-hidden
              >
                <span
                  className="block w-full rounded-full bg-success transition-[height] duration-700 ease-out"
                  style={{ height: state === "done" ? "100%" : "0%" }}
                />
              </span>
            )}
            <StepIndicator state={state} icon={step.icon} />
            <div className="flex min-w-0 flex-1 flex-col pt-1.5">
              <span
                className={cn(
                  "text-sm font-medium transition-colors",
                  state === "todo" && "text-muted-foreground",
                )}
              >
                {state === "done" ? step.done : step.title}
              </span>
              {state === "current" && (
                <div className="animate-in duration-200 fade-in motion-reduce:animate-none">
                  <p className="mt-1 text-sm text-muted-foreground">
                    {step.hint}
                  </p>
                  <BackgroundCheck
                    stage={stage}
                    stopped={stopped}
                    checking={checking}
                    checkedAt={checkedAt}
                    interval={interval}
                  />
                  {children}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The finish: the domain works over https. `celebrate` when it got there
 * while the owner watched — the badge rings a few times.
 */
export function DomainReady({
  hostname,
  url,
  celebrate,
  actions,
}: {
  hostname: string;
  url: string;
  celebrate: boolean;
  /** Check again, disconnect. */
  actions: ReactNode;
}) {
  const { copied, copy } = useCopied();
  return (
    <div className="relative flex animate-in flex-col gap-4 overflow-hidden rounded-xl border border-success/30 bg-success/5 p-5 duration-500 fade-in zoom-in-95 motion-reduce:animate-none">
      <div
        className="pointer-events-none absolute -top-24 -right-24 size-56 rounded-full bg-success/10 blur-3xl"
        aria-hidden
      />
      <div className="relative flex items-center gap-4">
        <span className="relative flex size-12 shrink-0 items-center justify-center">
          {celebrate && (
            <span
              className="absolute inset-0 animate-ping rounded-full bg-success/40 [animation-iteration-count:4] motion-reduce:animate-none"
              aria-hidden
            />
          )}
          <span className="relative flex size-12 items-center justify-center rounded-full bg-success text-white shadow-sm">
            <CheckIcon className="size-6" strokeWidth={3} aria-hidden />
          </span>
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm text-muted-foreground">
            Сайт полностью готов
          </span>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-xl font-semibold break-all transition-colors hover:text-primary"
          >
            {hostname}
          </a>
        </div>
      </div>
      <div className="relative flex flex-wrap gap-2">
        <Badge variant="success-light">
          <ShieldCheckIcon aria-hidden />
          Владение подтверждено
        </Badge>
        <Badge variant="success-light">
          <WaypointsIcon aria-hidden />
          DNS настроен
        </Badge>
        <Badge variant="success-light">
          <LockIcon aria-hidden />
          SSL-сертификат активен
        </Badge>
      </div>
      <p className="relative text-sm text-muted-foreground">
        Клиенты открывают страницу записи по вашему адресу, соединение защищено.
        Сертификат продлевается сам. TXT-запись больше не нужна — её можно
        удалить.
      </p>
      <div className="relative flex flex-wrap items-center gap-2">
        <Button
          nativeButton={false}
          render={<a href={url} target="_blank" rel="noreferrer" />}
        >
          <ExternalLinkIcon />
          Открыть сайт
        </Button>
        <Button
          variant="outline"
          onClick={() => copy(url, "Ссылка скопирована")}
        >
          <CopyStateIcon copied={copied} />
          Скопировать ссылку
        </Button>
        <div className="ml-auto flex gap-2">{actions}</div>
      </div>
    </div>
  );
}
