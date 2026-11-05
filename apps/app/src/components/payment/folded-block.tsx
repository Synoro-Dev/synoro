"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@synoro/ui";
import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";

/** What most specialists never need: out of the way until asked for. */
export function FoldedBlock({
  title,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  /** Leave out to let the block keep its own state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-md border"
    >
      <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&[data-panel-open]>svg]:rotate-180">
        {title}
        <ChevronDownIcon
          className="size-4 shrink-0 text-muted-foreground transition-transform"
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-3 px-3 pb-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
