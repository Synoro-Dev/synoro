"use client";

import { Button, Skeleton, toast } from "@acme/ui";
import { Alert, AlertDescription, AlertTitle } from "@acme/ui/reui/alert";
import { Badge } from "@acme/ui/reui/badge";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@acme/ui/reui/frame";
import { IconTile } from "@acme/ui/reui/icon-tile";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { orpc } from "~/orpc/react";
import { ROLE_LABELS } from "../sidebar/types";
import { ErrorState } from "./states";

/**
 * Pending invitations for the caller's verified email. Accepting one makes
 * them a client or administrator of that practice.
 */
export function PracticeInvitations() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pending = useQuery(orpc.practice.invitations.queryOptions());
  const accept = useMutation({
    ...orpc.practice.acceptInvitation.mutationOptions(),
    onSuccess: async () => {
      toast.success("Приглашение принято");
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
      // The sidebar's practice list is rendered on the server.
      router.refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  if (pending.isPending) return <Skeleton className="h-20 w-full rounded-xl" />;
  if (pending.isError) {
    return (
      <ErrorState
        message="Не удалось загрузить приглашения."
        onRetry={() => pending.refetch()}
      />
    );
  }
  if (!pending.data.emailVerified) {
    return (
      <Alert variant="info">
        <MailIcon />
        <AlertTitle>Почта не подтверждена</AlertTitle>
        <AlertDescription>
          Чтобы увидеть приглашения в практики, войдите по одноразовому коду из
          письма.
        </AlertDescription>
      </Alert>
    );
  }
  if (pending.data.invitations.length === 0) return null;

  return (
    <Frame spacing="default" stacked>
      <FramePanel>
        <FrameHeader className="p-0">
          <FrameTitle>Приглашения</FrameTitle>
          <FrameDescription>Вас пригласили в практики</FrameDescription>
        </FrameHeader>
      </FramePanel>
      {pending.data.invitations.map((invitation) => (
        <FramePanel key={invitation.id} className="flex items-center gap-3">
          <IconTile variant="soft" aria-hidden="true">
            {invitation.practiceName.charAt(0).toUpperCase()}
          </IconTile>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-sm font-medium">
              {invitation.practiceName}
            </span>
            <Badge variant="primary-light">
              {ROLE_LABELS[invitation.role]}
            </Badge>
          </div>
          <Button
            size="sm"
            disabled={accept.isPending}
            onClick={() => accept.mutate({ invitationId: invitation.id })}
          >
            Принять
          </Button>
        </FramePanel>
      ))}
    </Frame>
  );
}
