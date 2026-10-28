"use client";

import { toast } from "@synoro/ui";
import {
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { orpc } from "~/orpc/react";
import { VideoLinkForm } from "./video-link";

/**
 * The specialist's permanent video room (Толк, Телемост…). Clients of
 * confirmed bookings get it in the email, on their booking page and in the
 * cabinet; a single booking can override it in its card.
 */
export function PracticeVideoLink({
  practiceId,
  videoUrl,
}: {
  practiceId: string;
  videoUrl: string | null;
}) {
  const queryClient = useQueryClient();
  const save = useMutation({
    ...orpc.practice.setVideoUrl.mutationOptions(),
    onSuccess: async (result) => {
      toast.success(
        result.videoUrl
          ? "Ссылка сохранена, клиентам с будущими записями отправлено письмо"
          : "Ссылка удалена",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.practice.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.booking.key() }),
      ]);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <FramePanel className="flex flex-col gap-4">
      <FrameHeader className="p-0">
        <FrameTitle>Видеовстреча</FrameTitle>
        <FrameDescription>
          Ваша постоянная комната в Толке или другом сервисе. Клиент получит её
          в письме, на странице записи и в кабинете.
        </FrameDescription>
      </FrameHeader>
      <VideoLinkForm
        // Re-seed the field when the saved value changes.
        key={videoUrl ?? ""}
        label="Ссылка на видеовстречу"
        placeholder="https://company.ktalk.ru/your-room"
        value={videoUrl}
        pending={save.isPending}
        onSave={(url) => save.mutate({ practiceId, videoUrl: url })}
      />
      <p className="text-xs text-muted-foreground">
        В Толке откройте комнату для внешних участников, иначе клиент не сможет
        войти.
      </p>
    </FramePanel>
  );
}
