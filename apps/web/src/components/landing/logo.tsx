import { cn } from "@synoro/ui";

import { brand } from "~/lib/brand";

/** A 2×2 slot grid with one slot booked. */
function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={cn("size-6", className)}
      fill="none"
    >
      <rect width="24" height="24" rx="7" className="fill-foreground" />
      <rect x="5.5" y="5.5" width="5.5" height="5.5" rx="1.5" fill="white" />
      <rect
        x="13"
        y="5.5"
        width="5.5"
        height="5.5"
        rx="1.5"
        fill="white"
        fillOpacity=".35"
      />
      <rect
        x="5.5"
        y="13"
        width="5.5"
        height="5.5"
        rx="1.5"
        fill="white"
        fillOpacity=".35"
      />
      <rect
        x="13"
        y="13"
        width="5.5"
        height="5.5"
        rx="1.5"
        fill="white"
        fillOpacity=".35"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 text-[17px] font-semibold tracking-tight",
        className,
      )}
    >
      <LogoMark />
      {brand.name}
    </span>
  );
}
