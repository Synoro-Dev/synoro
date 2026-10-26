"use client";

import type { RouterOutputs } from "@acme/api";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from "@acme/ui";
import { Badge } from "@acme/ui/reui/badge";
import { IconTile } from "@acme/ui/reui/icon-tile";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Clock3Icon,
  LockIcon,
  MailIcon,
  StickyNoteIcon,
  UserRoundIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { orpc } from "~/orpc/react";
import { formatDateTime, formatTime } from "./time";

export type CalendarBooking = RouterOutputs["booking"]["calendar"][number];

export const KIND_META = {
  consultation: {
    label: "Консультация",
    badge: "info-light",
    color: "var(--info)",
  },
  free: {
    label: "Бесплатная",
    badge: "success-light",
    color: "var(--success)",
  },
  blocked: {
    label: "Закрыто",
    badge: "outline",
    color: "var(--muted-foreground)",
  },
} as const;

export function bookingTitle(b: CalendarBooking) {
  if (b.kind === "consultation") return b.clientName ?? "Клиент удалён";
  if (b.kind === "free") return b.guestName ?? "Гость";
  return b.note ?? "Личное время";
}

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <IconTile size="sm" aria-hidden="true">
        {icon}
      </IconTile>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

/** Details of a booking, free consultation or block, with staff actions. */
export function BookingDialog({
  booking,
  onClose,
}: {
  booking: CalendarBooking | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const cancel = useMutation({
    ...orpc.booking.cancel.mutationOptions(),
    onSuccess: async (result) => {
      toast.success(
        result.kind === "blocked"
          ? "Время снова открыто для записи"
          : result.refunded
            ? "Отменено, консультация возвращена клиенту"
            : "Запись отменена",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.booking.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.practice.key() }),
      ]);
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Dialog open={booking !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {booking && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <DialogTitle className="truncate">
                  {bookingTitle(booking)}
                </DialogTitle>
                <Badge variant={KIND_META[booking.kind].badge}>
                  {KIND_META[booking.kind].label}
                </Badge>
              </div>
              <DialogDescription>
                {formatDateTime(booking.startsAt)}–{formatTime(booking.endsAt)}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              <Fact icon={<Clock3Icon />}>
                {Math.round(
                  (booking.endsAt.getTime() - booking.startsAt.getTime()) /
                    60_000,
                )}{" "}
                мин
              </Fact>
              {booking.kind === "consultation" && booking.clientEmail && (
                <Fact icon={<MailIcon />}>{booking.clientEmail}</Fact>
              )}
              {booking.kind === "free" && booking.guestContact && (
                <Fact icon={<UserRoundIcon />}>{booking.guestContact}</Fact>
              )}
              {booking.kind !== "blocked" && booking.note && (
                <Fact icon={<StickyNoteIcon />}>{booking.note}</Fact>
              )}
              {booking.kind === "blocked" && (
                <Fact icon={<LockIcon />}>Клиенты не могут записаться</Fact>
              )}
            </div>

            <DialogFooter>
              {booking.kind === "consultation" && (
                <Button
                  variant="outline"
                  disabled={cancel.isPending}
                  onClick={() =>
                    cancel.mutate({ bookingId: booking.id, refund: false })
                  }
                >
                  Без возврата
                </Button>
              )}
              <Button
                variant={booking.kind === "blocked" ? "default" : "destructive"}
                disabled={cancel.isPending}
                onClick={() => cancel.mutate({ bookingId: booking.id })}
              >
                {booking.kind === "blocked"
                  ? "Открыть время"
                  : booking.kind === "consultation"
                    ? "Отменить с возвратом"
                    : "Отменить"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
