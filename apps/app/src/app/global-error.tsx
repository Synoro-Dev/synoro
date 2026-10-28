"use client";

import { Button } from "@synoro/ui";
import { House, RotateCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { ErrorScreen } from "~/components/errors/error-screen";

import "~/app/styles.css";

/**
 * Последняя линия обороны: срабатывает, когда падает сам корневой layout, и
 * заменяет его целиком. Провайдера темы здесь нет.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  useEffect(() => {
    document.documentElement.classList.toggle(
      "dark",
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
  }, []);

  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <title>Ошибка сервиса</title>
      </head>
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <ErrorScreen
          code="500"
          title="Сервис временно недоступен"
          description="Произошёл серьёзный сбой. Обновите страницу через минуту — мы уже работаем над этим."
          icon={TriangleAlert}
          footnote={error.digest && <>ID ошибки: {error.digest}</>}
        >
          <Button onClick={() => window.location.reload()}>
            <RotateCw aria-hidden />
            Обновить страницу
          </Button>
          <Button variant="outline" render={<a href="/" />}>
            <House aria-hidden />
            На главную
          </Button>
        </ErrorScreen>
      </body>
    </html>
  );
}
