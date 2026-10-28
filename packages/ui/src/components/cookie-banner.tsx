"use client";

import { useEffect, useState } from "react";

import {
  type CookieConsent,
  readConsent,
  writeConsent,
} from "../cookie-consent";
import { Button } from "./button";

/**
 * Notice about analytics cookies. Analytics is on until the visitor presses
 * "Отказаться"; either button hides the banner for a year. `onChange` runs
 * after the choice is stored (stop the counters on "declined").
 */
export function CookieBanner({
  policyHref,
  sharedDomain,
  onChange,
}: {
  policyHref: string;
  /** Registrable domain to share the choice across subdomains, e.g. `synoro.ru`. */
  sharedDomain?: string;
  onChange?: (value: CookieConsent) => void;
}) {
  // Unknown until mounted: the server cannot see the cookie.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(readConsent() === undefined);
  }, []);

  if (!visible) return null;

  function choose(value: CookieConsent) {
    writeConsent(value, sharedDomain);
    setVisible(false);
    onChange?.(value);
  }

  return (
    <div
      role="region"
      aria-label="Уведомление о cookie"
      className="fixed inset-x-4 bottom-4 z-[60] mx-auto flex max-w-xl flex-col gap-3 rounded-xl border bg-background p-4 text-sm shadow-lg sm:left-4 sm:mx-0 sm:flex-row sm:items-center"
    >
      <p className="flex-1 text-pretty text-muted-foreground">
        Мы используем cookie и сервис «Яндекс Метрика», чтобы понимать, как
        работает сайт. Сбор статистики включён.{" "}
        <a
          href={policyHref}
          className="text-foreground underline underline-offset-2"
        >
          Подробнее
        </a>
      </p>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" onClick={() => choose("accepted")}>
          Понятно
        </Button>
        <Button size="sm" variant="outline" onClick={() => choose("declined")}>
          Отказаться
        </Button>
      </div>
    </div>
  );
}
