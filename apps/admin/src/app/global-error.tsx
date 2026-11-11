"use client";

import { cn, ServerErrorScreen, ThemeProvider } from "@synoro/ui";
import { Geist } from "next/font/google";

import "~/app/styles.css";

const geistSans = Geist({
  subsets: ["latin", "cyrillic"],
  variable: "--font-geist-sans",
});

/**
 * Падение самого корневого layout: он заменяется целиком, вместе со шрифтами
 * и темой. Поэтому и обновляем страницу целиком.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <title>Админка временно недоступна</title>
      </head>
      <body
        className={cn(
          "bg-background text-foreground min-h-screen font-sans antialiased",
          geistSans.variable,
        )}
      >
        <ThemeProvider>
          <ServerErrorScreen
            error={error}
            onRetry={() => window.location.reload()}
            retryLabel="Обновить страницу"
            title="Админка временно недоступна"
            description="Произошёл технический сбой. Обновите страницу через минуту."
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
