"use client";

import { cn, toast } from "@synoro/ui";
import { CheckIcon, CopyIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** How long the check mark replaces the copy icon after a successful copy. */
const COPIED_MS = 2000;

/**
 * Copies `text` to the clipboard and flips `copied` for a couple of seconds so
 * callers can swap the copy icon for a check.
 */
export function useCopied() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(text: string, done = "Скопировано") {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(done);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      toast.info(text);
    }
  }

  return { copied, copy };
}

/** The copy icon that becomes a check once copied. */
export function CopyStateIcon({
  copied,
  className,
}: {
  copied: boolean;
  className?: string;
}) {
  return copied ? (
    <CheckIcon className={cn("text-success", className)} aria-hidden />
  ) : (
    <CopyIcon className={className} aria-hidden />
  );
}

/**
 * A value that copies itself on click, with a small copy icon. For spots where
 * a full button would be too heavy — inline URLs, emails, domains.
 */
export function CopyValue({
  value,
  children,
  label,
  className,
}: {
  /** What lands in the clipboard. */
  value: string;
  /** What's shown; defaults to `value`. */
  children?: ReactNode;
  /** Accessible name; defaults to "Скопировать <value>". */
  label?: string;
  className?: string;
}) {
  const { copied, copy } = useCopied();

  return (
    <button
      type="button"
      aria-label={label ?? `Скопировать ${value}`}
      onClick={() => copy(value)}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-sm break-all transition-colors hover:text-primary",
        className,
      )}
    >
      {children ?? value}
      <CopyStateIcon copied={copied} className="size-3 shrink-0 opacity-50" />
    </button>
  );
}
