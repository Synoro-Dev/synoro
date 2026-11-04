"use client"

import { ArrowLeft, RotateCw } from "lucide-react"
import { type ReactNode, useEffect } from "react"

import { cn } from "."
import { Button } from "./button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./empty"

type ErrorCode = "403" | "404" | "500"
type Digit = "0" | "3" | "4" | "5"

/** Цифры на сетке 3×5: `#` — занятое окно, `.` — свободное. */
const GLYPHS: Record<Digit, readonly string[]> = {
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "3": ["###", "..#", "###", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "###", "..#", "###"],
}

const SLOT = 20
const STEP = 24
const DIGIT_STEP = 3 * STEP + 12

/**
 * Код ошибки, выложенный окнами расписания: тот же приём, что в логотипе
 * (сетка окон, часть занята). Низ среднего нуля есть в каждом коде: это окно
 * потеряно.
 */
function SlotCode({ code }: { code: ErrorCode }) {
  const digits = [...code] as Digit[]

  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${2 * DIGIT_STEP + 3 * STEP - 4} ${5 * STEP - 4}`}
      className="h-auto w-full"
    >
      {digits.flatMap((digit, d) =>
        GLYPHS[digit].flatMap((row, y) =>
          [...row].map((cell, x) => {
            const key = `${d}-${x}-${y}`
            const left = d * DIGIT_STEP + x * STEP
            const top = y * STEP
            return d === 1 && x === 1 && y === 4 ? (
              <rect
                key={key}
                x={left + 0.75}
                y={top + 0.75}
                width={SLOT - 1.5}
                height={SLOT - 1.5}
                rx={4.5}
                strokeWidth={1.5}
                strokeDasharray="3.5 3"
                className="fill-none stroke-muted-foreground"
              />
            ) : (
              <rect
                key={key}
                x={left}
                y={top}
                width={SLOT}
                height={SLOT}
                rx={5}
                className={
                  cell === "#" ? "fill-foreground" : "fill-foreground/8"
                }
              />
            )
          })
        )
      )}
    </svg>
  )
}

/** Логотип: в отличие от `/icon.svg` не теряется на тёмном фоне. */
function BrandMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6">
      <rect width="24" height="24" rx="7" className="fill-foreground" />
      {[
        [5.5, 5.5, 1],
        [13, 5.5, 0.35],
        [5.5, 13, 0.35],
        [13, 13, 0.35],
      ].map(([x, y, opacity]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="5.5"
          height="5.5"
          rx="1.5"
          fillOpacity={opacity}
          className="fill-background"
        />
      ))}
    </svg>
  )
}

interface ErrorScreenProps {
  code: ErrorCode
  title: string
  description: ReactNode
  /** Кнопки действий: главная первой. */
  children?: ReactNode
  /** Мелкий текст под кнопками: куда писать, код ошибки. */
  footnote?: ReactNode
  /**
   * `page` занимает весь экран, `inline` встаёт внутрь уже отрисованной
   * оболочки кабинета.
   */
  variant?: "page" | "inline"
  /**
   * Логотип Synoro над экраном. По умолчанию на `page`; выключается там, где
   * страница принадлежит практике: запись на её собственном домене.
   */
  brand?: boolean
}

/** Общий экран ошибки всех приложений: 403, 404, 500. */
function ErrorScreen({
  code,
  title,
  description,
  children,
  footnote,
  variant = "page",
  brand = variant === "page",
}: ErrorScreenProps) {
  const Root = variant === "page" ? "main" : "div"

  return (
    <Root
      className={cn(
        "flex flex-col",
        variant === "page" ? "min-h-svh" : "min-h-[60svh] flex-1"
      )}
    >
      {brand && (
        <div className="flex items-center gap-2 p-6 text-[17px] font-semibold tracking-tight">
          <BrandMark />
          Synoro
        </div>
      )}
      <Empty
        data-error-code={code}
        className="gap-8 p-6 duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] animate-in fade-in motion-safe:slide-in-from-bottom-2"
      >
        <EmptyHeader className="max-w-md">
          <EmptyMedia
            className={cn(
              "mb-6 w-full",
              variant === "page" ? "max-w-60 sm:max-w-72" : "max-w-44"
            )}
          >
            <SlotCode code={code} />
          </EmptyMedia>
          <EmptyTitle
            className={cn(
              "font-semibold",
              variant === "page" ? "text-2xl sm:text-3xl" : "text-xl"
            )}
          >
            <h1>
              <span className="sr-only">Ошибка {code}. </span>
              {title}
            </h1>
          </EmptyTitle>
          <EmptyDescription className="text-pretty sm:text-base/relaxed">
            {description}
          </EmptyDescription>
        </EmptyHeader>
        {children && (
          <EmptyContent className="max-w-md flex-row flex-wrap justify-center gap-2">
            {children}
          </EmptyContent>
        )}
        {footnote && (
          <EmptyDescription className="max-w-md text-xs/relaxed text-pretty">
            {footnote}
          </EmptyDescription>
        )}
      </Empty>
    </Root>
  )
}

/** «Назад» по истории браузера; без истории ведёт на `fallbackHref`. */
function BackButton({ fallbackHref = "/" }: { fallbackHref?: string }) {
  return (
    <Button
      variant="outline"
      onClick={() => {
        if (window.history.length > 1) window.history.back()
        else window.location.assign(fallbackHref)
      }}
    >
      <ArrowLeft data-icon="inline-start" aria-hidden />
      Назад
    </Button>
  )
}

function ServerErrorNote({
  support,
  digest,
}: {
  support?: string
  digest?: string
}) {
  if (!support) return digest ? <>Код ошибки: {digest}</> : null
  return (
    <>
      Если ошибка повторится, напишите на{" "}
      <a href={`mailto:${support}`}>{support}</a>
      {digest && <> и укажите код {digest}</>}.
    </>
  )
}

interface ServerErrorScreenProps
  extends Pick<ErrorScreenProps, "variant" | "brand" | "children"> {
  error: Error & { digest?: string }
  onRetry: () => void
  retryLabel?: string
  title?: string
  description?: string
  /** Почта поддержки; в админке не нужна. */
  support?: string
}

/** Тело `error.tsx` и `global-error.tsx`; `children` — действия после повтора. */
function ServerErrorScreen({
  error,
  onRetry,
  retryLabel = "Попробовать снова",
  title = "Не удалось открыть страницу",
  description = "Произошёл технический сбой. Попробуйте ещё раз — обычно это помогает.",
  support,
  children,
  ...screen
}: ServerErrorScreenProps) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <ErrorScreen
      code="500"
      title={title}
      description={description}
      footnote={<ServerErrorNote support={support} digest={error.digest} />}
      {...screen}
    >
      <Button onClick={onRetry}>
        <RotateCw data-icon="inline-start" aria-hidden />
        {retryLabel}
      </Button>
      {children}
    </ErrorScreen>
  )
}

export { BackButton, ErrorScreen, ServerErrorScreen }
