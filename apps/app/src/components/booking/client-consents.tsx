"use client";

import { Skeleton } from "@synoro/ui";
import { useQuery } from "@tanstack/react-query";
import { FileCheckIcon } from "lucide-react";

import { EmptyState, ErrorState } from "~/components/booking/states";
import { orpc } from "~/orpc/react";

/**
 * What a client has accepted: each document with the version and the day,
 * newest first, and for a child — who consented for whom. Real people's
 * names, so `ph-no-capture`.
 */
export function ClientConsents({
  practiceId,
  memberId,
}: {
  practiceId: string;
  memberId: string;
}) {
  const consents = useQuery(
    orpc.document.consents.queryOptions({ input: { practiceId, memberId } }),
  );

  if (consents.isError) {
    return <ErrorState onRetry={() => consents.refetch()} />;
  }
  if (consents.isPending) {
    return <Skeleton className="h-32 w-full rounded-xl" />;
  }
  if (consents.data.length === 0) {
    return (
      <EmptyState
        icon={FileCheckIcon}
        title="Согласий пока нет"
        description="Клиент принимает ваши документы, когда записывается сам. Документы задаются в настройках практики."
      />
    );
  }

  return (
    <ul className="ph-no-capture flex flex-col divide-y rounded-lg border">
      {consents.data.map((consent) => (
        <li key={consent.id} className="flex flex-col gap-0.5 px-3 py-2.5">
          <span className="text-sm font-medium">{consent.title}</span>
          <span className="text-sm text-muted-foreground">
            Версия {consent.version} ·{" "}
            {consent.acceptedAt.toLocaleDateString("ru-RU", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            ,{" "}
            {consent.acceptedAt.toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {consent.representativeName && (
            <span className="text-sm text-muted-foreground">
              За ребёнка ({consent.minorName}) — {consent.representativeName}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
