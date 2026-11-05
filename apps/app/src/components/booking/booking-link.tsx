"use client";

import { Button, Input, toast } from "@synoro/ui";
import { CodeIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.info(text);
  }
}

/** The booking page's link with copy, the page itself and the embed code. */
export function BookingLinkActions({ url }: { url: string }) {
  return (
    <>
      <div className="flex gap-2">
        <Input readOnly value={url} aria-label="Ссылка для записи" />
        <Button
          variant="outline"
          size="icon"
          aria-label="Скопировать ссылку"
          onClick={() => copy(url, "Ссылка скопирована")}
        >
          <CopyIcon />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<a href={url} target="_blank" rel="noreferrer" />}
        >
          <ExternalLinkIcon />
          Открыть
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            copy(
              `<iframe src="${url}" title="Онлайн-запись" style="width:100%;height:720px;border:0" loading="lazy"></iframe>`,
              "Код скопирован — вставьте его на свой сайт",
            )
          }
        >
          <CodeIcon />
          Код для сайта
        </Button>
      </div>
    </>
  );
}
