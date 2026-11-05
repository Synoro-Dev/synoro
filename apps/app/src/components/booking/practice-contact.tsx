"use client";

import { Button, Input, toast } from "@synoro/ui";
import {
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import { practiceContactSchema } from "@synoro/validators";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "~/orpc/react";

/**
 * How clients reach the specialist when they can no longer change a booking
 * themselves. Clients of confirmed bookings see it, the public page never.
 */
export function PracticeContact({
  practiceId,
  contact,
}: {
  practiceId: string;
  contact: string | null;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(contact ?? "");
  // The `contact` prop comes from the server page and stays as first loaded.
  const [saved, setSaved] = useState(contact ?? "");
  const dirty = draft.trim() !== saved;
  const save = useMutation({
    ...orpc.practice.setContact.mutationOptions(),
    onSuccess: async (result) => {
      setSaved(result.contact ?? "");
      toast.success(result.contact ? "Контакт сохранён" : "Контакт удалён");
      await queryClient.invalidateQueries({ queryKey: orpc.practice.key() });
    },
    onError: (error) => toast.error(error.message),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = practiceContactSchema.safeParse(draft);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Проверьте контакт");
      return;
    }
    save.mutate({ practiceId, contact: draft });
  }

  return (
    <FramePanel className="flex flex-col gap-4">
      <FrameHeader className="p-0">
        <FrameTitle>Контакт для клиентов</FrameTitle>
        <FrameDescription>
          Телефон, Telegram или другой способ связи. Его видят только клиенты с
          подтверждённой записью: на странице своей записи и в кабинете, когда
          до начала меньше 24 часов.
        </FrameDescription>
      </FrameHeader>
      <form onSubmit={submit} className="flex gap-2">
        <Input
          type="text"
          aria-label="Контакт для клиентов"
          placeholder="+7 900 123-45-67 или @anna"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" disabled={save.isPending || !dirty}>
          Сохранить
        </Button>
      </form>
    </FramePanel>
  );
}
