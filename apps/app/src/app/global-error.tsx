"use client";

import { legal } from "@synoro/config";
import { cn, ServerErrorScreen, ThemeProvider } from "@synoro/ui";
import { Onest } from "next/font/google";

import "~/app/styles.css";

const onest = Onest({
  subsets: ["latin", "cyrillic"],
  variable: "--font-onest",
});

/**
 * Последняя линия обороны: срабатывает, когда падает сам корневой layout, и
 * заменяет его целиком, вместе со шрифтами и темой. Поэтому и обновляем
 * страницу целиком, а не повторяем рендер.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <title>Сервис временно недоступен</title>
      </head>
      <body
        className={cn(
          "bg-background text-foreground min-h-screen font-sans antialiased",
          onest.variable,
        )}
      >
        <ThemeProvider>
          <ServerErrorScreen
            error={error}
            onRetry={() => window.location.reload()}
            retryLabel="Обновить страницу"
            title="Сервис временно недоступен"
            description="Произошёл технический сбой. Обновите страницу через минуту."
            support={legal.operator.email}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
