"use client";

import { useEffect } from "react";

import { identifyUser } from "~/lib/analytics";

/** Rendered for a signed-in user: attributes the browser's events to them. */
export function AnalyticsIdentify({ userId }: { userId: string }) {
  useEffect(() => {
    identifyUser(userId);
  }, [userId]);

  return null;
}
