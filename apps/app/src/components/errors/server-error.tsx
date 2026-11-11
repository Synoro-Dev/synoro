"use client";

import { legal, paths } from "@synoro/config";
import { buttonVariants, ServerErrorScreen } from "@synoro/ui";
import { House } from "lucide-react";
import Link from "next/link";

/** Тело `error.tsx`: общее для корня, кабинета и настроек. */
export function ServerError({
  error,
  retry,
  title,
  variant,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  title?: string;
  variant?: "page" | "inline";
}) {
  return (
    <ServerErrorScreen
      error={error}
      onRetry={retry}
      title={title}
      variant={variant}
      support={legal.operator.email}
    >
      <Link
        href={paths.dashboard.root}
        className={buttonVariants({ variant: "outline" })}
      >
        <House data-icon="inline-start" aria-hidden />
        На главную
      </Link>
    </ServerErrorScreen>
  );
}
