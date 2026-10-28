"use client";

import { legal } from "@synoro/config";
import { Button } from "@synoro/ui";
import {
  type CookieConsent,
  readConsent,
  stopYandexMetrika,
  writeConsent,
} from "@synoro/ui/cookie-consent";
import { useEffect, useState } from "react";

/** Current analytics choice with a switch, for the cookie policy page. */
export function CookieChoice({ counterId }: { counterId: number }) {
  // Unknown until mounted: the server cannot see the cookie.
  const [declined, setDeclined] = useState<boolean | null>(null);

  useEffect(() => {
    setDeclined(readConsent() === "declined");
  }, []);

  if (declined === null) return null;

  function choose(value: CookieConsent) {
    writeConsent(value, new URL(legal.siteUrl).hostname);
    if (value === "declined") stopYandexMetrika(counterId);
    setDeclined(value === "declined");
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
      <p className="flex-1">
        {declined
          ? "Вы отказались от аналитики: счётчик не загружается."
          : "Аналитика включена."}
      </p>
      {declined ? (
        <Button size="sm" onClick={() => choose("accepted")}>
          Включить аналитику
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={() => choose("declined")}>
          Отказаться
        </Button>
      )}
    </div>
  );
}
