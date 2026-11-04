"use client";

import { legal } from "@synoro/config";
import { cn, ServerErrorScreen } from "@synoro/ui";
import { Onest } from "next/font/google";

import "~/app/styles.css";

const onest = Onest({
  subsets: ["latin", "cyrillic"],
  variable: "--font-onest",
});

/**
 * Падение самого корневого layout: он заменяется целиком, вместе со шрифтами.
 * Поэтому и обновляем страницу целиком.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="ru">
      <head>
        <title>Сайт временно недоступен</title>
      </head>
      <body
        className={cn(
          "bg-background text-foreground min-h-screen font-sans antialiased",
          onest.variable,
        )}
      >
        <ServerErrorScreen
          error={error}
          onRetry={() => window.location.reload()}
          retryLabel="Обновить страницу"
          title="Сайт временно недоступен"
          description="Произошёл технический сбой. Обновите страницу через минуту."
          support={legal.operator.email}
        />
      </body>
    </html>
  );
}
