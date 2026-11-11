"use client";

import { toast } from "@synoro/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { viewerTimeZoneName } from "./time";
import { TimeZoneSelect } from "./time-zone-select";

/**
 * The zone the practice's working hours are written in. The owner picks it;
 * clients still see the free times in their own zone.
 */
export function PracticeTimeZone({
  practiceId,
  timezone,
}: {
  practiceId: string;
  timezone: string;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [value, setValue] = useState(timezone);
  const save = useMutation({
    ...orpc.practice.setTimezone.mutationOptions(),
    onSuccess: async (result) => {
      setValue(result.timezone);
      toast.success(
        `Рабочие часы теперь по времени: ${viewerTimeZoneName(result.timezone)}. Часы в таблице остались прежними.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.practice.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.booking.key() }),
      ]);
      // The page header comes from the server.
      router.refresh();
    },
    onError: (error) => {
      setValue(timezone);
      toast.error(error.message);
    },
  });

  return (
    <TimeZoneSelect
      value={value}
      disabled={save.isPending}
      onChange={(next) => {
        setValue(next);
        save.mutate({ practiceId, timezone: next });
      }}
    />
  );
}
