"use client";

import { CircleCheckIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * The console saves with an explicit button everywhere (one model for the
 * whole console): text, grids and lists are drafts until «Сохранить»; a single
 * switch applies at once. This is the status beside that button —
 * «Есть несохранённые изменения» while dirty, «Сохранено» right after —
 * and it asks before the tab closes on a draft.
 */
export function SaveState({
  dirty,
  savedAt,
}: {
  dirty: boolean;
  /** Bumped (e.g. `Date.now()` in onSuccess) when a save lands. */
  savedAt: number | null;
}) {
  useLeaveGuard(dirty);
  const [fresh, setFresh] = useState(false);
  const last = useRef(savedAt);

  useEffect(() => {
    if (savedAt === null || savedAt === last.current) return;
    last.current = savedAt;
    setFresh(true);
    const timer = setTimeout(() => setFresh(false), 4000);
    return () => clearTimeout(timer);
  }, [savedAt]);

  return (
    <span role="status" className="text-sm text-muted-foreground">
      {dirty ? (
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
          Есть несохранённые изменения
        </span>
      ) : fresh ? (
        <span className="flex items-center gap-1.5 text-brand-foreground">
          <CircleCheckIcon className="size-4" aria-hidden="true" />
          Сохранено
        </span>
      ) : null}
    </span>
  );
}

/** Asks before the tab closes or reloads while there is a draft. */
export function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
