"use client";

import { CircleCheckIcon } from "lucide-react";
import { useEffect, useState } from "react";

/** How long «Сохранено» stays after a save. */
const FRESH_MS = 4000;

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
  /**
   * `Date.now()` of the last save. Keep it above any `key` that remounts
   * the editor, or the status forgets the save.
   */
  savedAt: number | null;
}) {
  useLeaveGuard(dirty);
  const [fresh, setFresh] = useState(false);

  // Read on mount too: an editor remounted by the refetch after saving
  // still says «Сохранено» for what is left of the moment.
  useEffect(() => {
    if (savedAt === null) return;
    const left = savedAt + FRESH_MS - Date.now();
    if (left <= 0) return;
    setFresh(true);
    const timer = setTimeout(() => setFresh(false), left);
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
function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
