"use client";

import { legal } from "@synoro/config";
import { buttonVariants, ServerErrorScreen } from "@synoro/ui";
import { House } from "lucide-react";

export default function RootError({
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
      support={legal.operator.email}
    >
      <a href="/" className={buttonVariants({ variant: "outline" })}>
        <House data-icon="inline-start" aria-hidden />
        На главную
      </a>
    </ServerErrorScreen>
  );
}
