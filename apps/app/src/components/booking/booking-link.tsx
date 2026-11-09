"use client";

import { Button, Input, toast } from "@synoro/ui";
import { Badge } from "@synoro/ui/reui/badge";
import {
  CodeIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LockIcon,
} from "lucide-react";

import { embedCode } from "~/lib/embed";

import { CopyValue } from "../copy-value";

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.info(text);
  }
}

/** The practice's own domain once it fully works (`practice.get`). */
export type SiteDomain = { hostname: string; url: string } | null;

/**
 * The booking page's link with copy, the page itself and the embed code. With
 * an own domain connected, that domain is the link to share, shown first; the
 * platform address keeps working beside it (and is what the embed loads).
 */
export function BookingLinkActions({
  url,
  siteDomain,
}: {
  url: string;
  siteDomain?: SiteDomain;
}) {
  const share = siteDomain?.url ?? url;
  return (
    <>
      {siteDomain && (
        <a
          href={siteDomain.url}
          target="_blank"
          rel="noreferrer"
          className="group flex min-w-0 items-center gap-3 rounded-lg border border-success/30 bg-success/5 px-3 py-2.5 transition-colors hover:bg-success/10"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
            <GlobeIcon className="size-4" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold">
              {siteDomain.hostname}
            </span>
            <span className="text-xs text-muted-foreground">
              Ваш домен · https
            </span>
          </span>
          <Badge variant="success-light" className="shrink-0">
            <LockIcon aria-hidden />
            SSL
          </Badge>
        </a>
      )}
      <div className="flex gap-2">
        <Input readOnly value={share} aria-label="Ссылка для записи" />
        <Button
          variant="outline"
          size="icon"
          aria-label="Скопировать ссылку"
          onClick={() => copy(share, "Ссылка скопирована")}
        >
          <CopyIcon />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<a href={share} target="_blank" rel="noreferrer" />}
        >
          <ExternalLinkIcon />
          Открыть
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            copy(embedCode(url), "Код скопирован — вставьте его на свой сайт")
          }
        >
          <CodeIcon />
          Код для сайта
        </Button>
      </div>
      {siteDomain && (
        <p className="text-xs text-muted-foreground">
          Адрес на платформе тоже работает: <CopyValue value={url} />
        </p>
      )}
    </>
  );
}
