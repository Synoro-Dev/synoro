"use client";

import { Button, Skeleton } from "@synoro/ui";
import { Badge } from "@synoro/ui/reui/badge";
import { useQuery } from "@tanstack/react-query";
import { ShieldIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { CopyValue } from "../copy-value";
import { ROLE_LABELS } from "../sidebar/types";
import { AddMemberDialog } from "./client-dialogs";
import { ErrorState, PageHeading } from "./states";

/** Who runs the practice with its owner; the owner invites administrators. */
export function PracticeTeam({
  practiceId,
  isOwner,
}: {
  practiceId: string;
  isOwner: boolean;
}) {
  const members = useQuery(
    orpc.practice.members.queryOptions({ input: { practiceId } }),
  );
  const [adding, setAdding] = useState(false);
  const team = (members.data ?? []).filter((m) => m.role !== "client");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeading
        title="Команда"
        description="Администратор ведёт записи, балансы и рабочие часы. Аналитику, оплату и сообщения клиентам он не видит."
      />
      {members.isError ? (
        <ErrorState onRetry={() => members.refetch()} />
      ) : members.isPending ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {team.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-3">
              <ShieldIcon
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{m.name}</span>
                <CopyValue
                  value={m.email}
                  className="w-fit text-sm text-muted-foreground"
                />
              </span>
              <Badge variant="outline">{ROLE_LABELS[m.role]}</Badge>
            </li>
          ))}
        </ul>
      )}
      {isOwner && (
        <div>
          <Button variant="outline" onClick={() => setAdding(true)}>
            <ShieldIcon />
            Пригласить администратора
          </Button>
        </div>
      )}
      <AddMemberDialog
        practiceId={practiceId}
        invite="admin"
        open={adding}
        onClose={() => setAdding(false)}
      />
    </div>
  );
}
