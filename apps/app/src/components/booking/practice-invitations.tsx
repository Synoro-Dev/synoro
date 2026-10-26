"use client";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  toast,
} from "@acme/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { orpc } from "~/orpc/react";
import { ROLE_LABELS } from "./practice-list";
import { QueryError } from "./query-error";

export function PracticeInvitations() {
  const queryClient = useQueryClient();
  const pending = useQuery(orpc.practice.invitations.queryOptions());
  const accept = useMutation({
    ...orpc.practice.acceptInvitation.mutationOptions(),
    onSuccess: async () => {
      toast.success("Приглашение принято");
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
    },
    onError: (error) => toast.error(error.message),
  });

  if (pending.isPending) return <Skeleton className="h-24 w-full" />;
  if (pending.isError)
    return (
      <QueryError
        message="Не удалось загрузить приглашения."
        retry={() => pending.refetch()}
        isFetching={pending.isFetching}
      />
    );
  if (!pending.data.emailVerified)
    return (
      <p className="text-sm text-muted-foreground">
        Чтобы увидеть и принять приглашения, выйдите и войдите по одноразовому
        коду из почты.
      </p>
    );
  if (!pending.data.invitations.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Приглашения в практики</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {pending.data.invitations.map((invitation) => (
          <div
            key={invitation.id}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <span>
              {invitation.practiceName} · {ROLE_LABELS[invitation.role]}
            </span>
            <Button
              size="sm"
              disabled={accept.isPending}
              onClick={() => accept.mutate({ invitationId: invitation.id })}
            >
              Принять приглашение
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
