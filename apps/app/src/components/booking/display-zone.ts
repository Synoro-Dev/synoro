"use client";

import { canonicalTimeZone } from "@synoro/validators";
import { useSyncExternalStore } from "react";

import { viewerTimeZone } from "./time";

/** Where the zone a visitor picked is remembered, per browser. */
const STORAGE_KEY = "synoro:time-zone";

const listeners = new Set<() => void>();
/** The pick of this visit: it holds even when storage is blocked. */
let picked: string | null | undefined;

function readStored() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (canonicalTimeZone(stored) ?? null) : null;
  } catch {
    // Storage is blocked (private mode, an iframe): the browser's zone it is.
    return null;
  }
}

const snapshot = () => (picked === undefined ? readStored() : picked);

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab picked a zone: what it stored is the pick now.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    picked = undefined;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The zone times are shown in: the one the visitor picked, else their
 * browser's. `picked` is the visitor's own pick (null: none on this origin).
 * `setZone(null)` goes back to the browser's. The server knows no pick, so
 * the browser's zone is what the first render has.
 */
export function useDisplayZone() {
  const stored = useSyncExternalStore(subscribe, snapshot, () => null);
  const browserZone = viewerTimeZone();

  function setZone(next: string | null) {
    const zone = next && next !== browserZone ? next : null;
    picked = zone;
    try {
      if (zone) localStorage.setItem(STORAGE_KEY, zone);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Not remembered: the next visit starts from the browser's zone.
    }
    for (const listener of listeners) listener();
  }

  return { zone: stored ?? browserZone, picked: stored, browserZone, setZone };
}
