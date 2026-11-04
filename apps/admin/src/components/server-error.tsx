"use client";

import { buttonVariants, ServerErrorScreen } from "@synoro/ui";
import { LayoutDashboard } from "lucide-react";
import Link from "next/link";

/** Тело `error.tsx`: общее для корня и разделов админки. */
export function ServerError({
  error,
  retry,
  variant,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  variant?: "page" | "inline";
}) {
  return (
    <ServerErrorScreen error={error} onRetry={retry} variant={variant}>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        <LayoutDashboard data-icon="inline-start" aria-hidden />
        На обзор
      </Link>
    </ServerErrorScreen>
  );
}
