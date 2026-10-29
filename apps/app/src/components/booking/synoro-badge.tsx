import { legal } from "@synoro/config";
import { cn } from "@synoro/ui";

/** The landing (`legal.siteUrl`), tagged so sign-ups from the badge count. */
const badgeUrl = new URL("/?ref=badge", legal.siteUrl).href;

/**
 * «Онлайн-запись — Synoro» at the bottom of a free practice's booking page;
 * whether to show it comes from the server (`showBadge`).
 */
export function SynoroBadge({ className }: { className?: string }) {
  return (
    <p className={cn("text-center text-xs text-muted-foreground", className)}>
      Онлайн-запись —{" "}
      <a
        href={badgeUrl}
        target="_blank"
        rel="noopener"
        className="font-medium underline-offset-2 transition-colors hover:text-foreground hover:underline"
      >
        Synoro
      </a>
    </p>
  );
}
