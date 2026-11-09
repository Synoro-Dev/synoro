"use client";

import { cn, toast } from "@synoro/ui";
import { CopyIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A value that copies itself on click, with a small copy icon. For spots where
 * a full button would be too heavy — inline URLs, emails, domains.
 */
export function CopyValue({
  value,
  children,
  label = "Скопировать",
  className,
}: {
  /** What lands in the clipboard. */
  value: string;
  /** What's shown; defaults to `value`. */
  children?: ReactNode;
  label?: string;
  className?: string;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Скопировано");
    } catch {
      toast.info(value);
    }
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={copy}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-sm break-all transition-colors hover:text-primary",
        className,
      )}
    >
      {children ?? value}
      <CopyIcon className="size-3 shrink-0 opacity-50" aria-hidden />
    </button>
  );
}
