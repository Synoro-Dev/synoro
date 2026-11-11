import { Skeleton } from "@synoro/ui";
import { Frame, FramePanel } from "@synoro/ui/reui/frame";

import type { ReactNode } from "react";

/**
 * Shared layout for the settings pages and their loading state: a header,
 * a navigation panel (phones only: from `md` the main sidebar lists the
 * sections) and a content panel, both ReUI frames.
 */
export function SettingsShell({
  header,
  sidebar,
  children,
}: {
  header: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex max-w-3xl flex-col gap-6 p-10 pb-16">
      <div className="flex flex-col gap-1">{header}</div>
      <aside className="md:hidden">
        <Frame spacing="xs">
          <FramePanel>{sidebar}</FramePanel>
        </Frame>
      </aside>
      <Frame>
        <FramePanel>{children}</FramePanel>
      </Frame>
    </div>
  );
}

export function SettingsHeader() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Настройки</h1>
      <p className="text-muted-foreground">
        Управляйте настройками аккаунта и параметрами уведомлений по почте.
      </p>
    </>
  );
}

/** Placeholder for a settings form while its data streams in. */
export function SettingsFormSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      {["a", "b", "c"].map((key) => (
        <div key={key} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24 rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      ))}
      <Skeleton className="mt-2 h-10 w-28 rounded-md" />
    </div>
  );
}
