"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { orpc } from "~/orpc/react";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Keeps a days-left count honest in a tab left open: re-renders when the
 * count next drops, and refetches the plan once `until` passes, so the
 * server's verdict replaces a stale «Про».
 */
export function usePlanClock(until: Date | null) {
  const queryClient = useQueryClient();
  const [, setTick] = useState(0);

  // No deps: after each tick's render, schedule the next one.
  useEffect(() => {
    if (!until) return;
    const remaining = until.getTime() - Date.now();
    if (remaining <= 0) return;
    const wait = remaining % DAY || DAY;
    const timer = setTimeout(() => {
      setTick((tick) => tick + 1);
      if (wait >= remaining) {
        void queryClient.invalidateQueries({ queryKey: orpc.billing.key() });
      }
    }, wait);
    return () => clearTimeout(timer);
  });
}
