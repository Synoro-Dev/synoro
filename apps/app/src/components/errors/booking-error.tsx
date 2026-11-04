"use client";

import { legal } from "@synoro/config";
import { ServerErrorScreen } from "@synoro/ui";

/**
 * Сбой на публичной странице записи. Посетитель не из кабинета, а страница
 * может стоять на домене практики: без логотипа и ссылки на главную.
 */
export function BookingError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ServerErrorScreen
      error={error}
      onRetry={retry}
      brand={false}
      support={legal.operator.email}
    />
  );
}
