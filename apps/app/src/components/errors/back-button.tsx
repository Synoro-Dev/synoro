"use client";

import { Button } from "@synoro/ui";
import { ArrowLeft } from "lucide-react";

/** «Назад» по истории браузера; без истории ведёт на главную. */
export function BackButton({ fallbackHref = "/" }: { fallbackHref?: string }) {
  return (
    <Button
      variant="outline"
      onClick={() => {
        if (window.history.length > 1) window.history.back();
        else window.location.assign(fallbackHref);
      }}
    >
      <ArrowLeft aria-hidden />
      Назад
    </Button>
  );
}
