"use client";

import { paths } from "@synoro/config";
import { Button, Skeleton } from "@synoro/ui";
import { Badge } from "@synoro/ui/reui/badge";
import { Frame, FramePanel } from "@synoro/ui/reui/frame";
import { IconTile } from "@synoro/ui/reui/icon-tile";
import { professionTerms } from "@synoro/validators";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, LayoutGridIcon, PlusIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { orpc } from "~/orpc/react";
import { ROLE_LABELS } from "../sidebar/types";
import { CreatePracticeDialog } from "./create-practice-form";
import { PracticeInvitations } from "./practice-invitations";
import { EmptyState, ErrorState, PageHeading } from "./states";

/** Practices the user runs (→ console) or is a client of (→ booking page). */
export function PracticeList() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const creating = searchParams.get("new") === "1";
  // Came from the landing's «Про» buttons: billing right after creating.
  const pro = searchParams.get("plan") === "pro";
  const practices = useQuery(orpc.practice.mine.queryOptions());
  const setCreating = (open: boolean) =>
    router.replace(
      (open ? `${paths.booking.practices}?new=1` : pathname) as Route,
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Практики"
        description="Где вы специалист, администратор или клиент"
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon />
            Новая практика
          </Button>
        }
      />

      <PracticeInvitations />

      {practices.isError ? (
        <ErrorState onRetry={() => practices.refetch()} />
      ) : practices.isPending ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : practices.data.length === 0 ? (
        <Frame spacing="default">
          <FramePanel>
            <EmptyState
              icon={LayoutGridIcon}
              title="Здесь пока пусто"
              description="Создайте практику, чтобы принимать записи."
              action={
                <Button size="sm" onClick={() => setCreating(true)}>
                  <PlusIcon />
                  Новая практика
                </Button>
              }
            />
          </FramePanel>
        </Frame>
      ) : (
        <Frame spacing="default" stacked>
          {practices.data.map((p) => {
            const staff = p.role !== "client";
            return (
              <FramePanel key={p.practiceId} className="p-0">
                <Link
                  href={
                    staff
                      ? paths.booking.practice(p.practiceId)
                      : paths.booking.public(p.slug)
                  }
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <IconTile variant="soft" aria-hidden="true">
                    {p.name.charAt(0).toUpperCase()}
                  </IconTile>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2 truncate text-sm font-medium">
                      {p.name}
                      <Badge variant={staff ? "primary-light" : "outline"}>
                        {ROLE_LABELS[p.role]}
                      </Badge>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {staff
                        ? `/p/${p.slug}`
                        : `Оплачено ${professionTerms(p.profession).credit[2]}: ${p.credits}`}
                    </span>
                  </div>
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
                </Link>
              </FramePanel>
            );
          })}
        </Frame>
      )}

      <CreatePracticeDialog
        open={creating}
        onOpenChange={setCreating}
        next={pro ? "billing" : "schedule"}
      />
    </div>
  );
}
