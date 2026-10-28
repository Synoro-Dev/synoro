"use client";

import { paths } from "@synoro/config";
import { Button } from "@synoro/ui";
import { House, RotateCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { ErrorScreen } from "./error-screen";

/** Тело `error.tsx` — общее для корня, кабинета и настроек. */
export function ServerError({
  error,
  reset,
  title = "Что-то пошло не так",
  variant = "page",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  variant?: "page" | "inline";
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorScreen
      code="500"
      title={title}
      description="Мы уже знаем о сбое и разбираемся. Попробуйте обновить страницу — чаще всего этого достаточно."
      icon={TriangleAlert}
      variant={variant}
      footnote={error.digest && <>ID ошибки: {error.digest}</>}
    >
      <Button onClick={reset}>
        <RotateCw aria-hidden />
        Попробовать снова
      </Button>
      <Button variant="outline" render={<Link href={paths.dashboard.root} />}>
        <House aria-hidden />
        На главную
      </Button>
    </ErrorScreen>
  );
}
