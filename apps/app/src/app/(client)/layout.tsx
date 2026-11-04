import { DEMO_ACCOUNTS } from "@synoro/auth/demo";
import { env, paths } from "@synoro/config";
import { Skeleton } from "@synoro/ui";
import type { Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { type ReactNode, Suspense } from "react";

import { getSession } from "~/auth/server";
import { AnalyticsIdentify } from "~/components/analytics-identify";
import { ClientMenu } from "~/components/client/client-menu";
import { api } from "~/orpc/server";

/**
 * The client's cabinet: no console sidebar, one narrow column read on a
 * phone. The header streams in with the session (see the dashboard layout
 * for why it isn't read at the top level).
 */
export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <div className="touch-targets flex min-h-svh flex-col bg-muted/40 dark:bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 px-4">
          <Link
            href={paths.booking.mine}
            className="flex items-center gap-2 rounded-md text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {/* biome-ignore lint/performance/noImgElement: a tiny static SVG. */}
            <img src="/icon.svg" alt="" className="size-6" />
            Synoro
          </Link>
          <div className="ml-auto">
            <Suspense fallback={<Skeleton className="size-9 rounded-full" />}>
              <SessionMenu />
            </Suspense>
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 md:py-10">
        {children}
      </div>
    </div>
  );
}

async function SessionMenu() {
  const session = await getSession();
  if (!session?.user) redirect(paths.auth.login);

  const practices = await api.practice.mine();
  const staff = practices.find((p) => p.role !== "client");

  return (
    <>
      <AnalyticsIdentify userId={session.user.id} />
      <ClientMenu
        user={{
          name: session.user.name,
          email: session.user.email,
          avatar: session.user.image || "",
        }}
        consoleHref={
          staff ? (paths.booking.practice(staff.practiceId) as Route) : null
        }
        demoAccounts={
          env.DEMO_LOGIN_EMAIL
            ? Object.entries(DEMO_ACCOUNTS).map(([key, account]) => ({
                key,
                label: account.label,
              }))
            : undefined
        }
      />
    </>
  );
}
