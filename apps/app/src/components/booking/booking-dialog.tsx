"use client";

import type { RouterOutputs } from "@synoro/api";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from "@synoro/ui";
import { Badge } from "@synoro/ui/reui/badge";
import { IconTile } from "@synoro/ui/reui/icon-tile";
import { capitalize, type ProfessionTerms } from "@synoro/validators";
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
import { useTerms } from "./terms";
import { formatDateTime, formatTime } from "./time";

export type CalendarBooking = RouterOutputs["booking"]["calendar"][number];

export const KIND_META = {
  consultation: { badge: "info-light", color: "var(--info)" },
  free: { badge: "success-light", color: "var(--success)" },
  blocked: { badge: "outline", color: "var(--muted-foreground)" },
} as const;

/** «Консультация» / «Знакомство» / «Закрыто» in the practice's words. */
export function kindLabel(
  kind: CalendarBooking["kind"],
  terms: ProfessionTerms,
) {
  if (kind === "consultation") return capitalize(terms.credit[0]);
  if (kind === "free") return terms.free;
  return "Закрыто";
}

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

/** Details of a booking, free booking or block, with staff actions. */
export function BookingDialog({
  booking,
  onClose,
}: {
  booking: CalendarBooking | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const terms = useTerms();
  const cancel = useMutation({
    ...orpc.booking.cancel.mutationOptions(),
    onSuccess: async (result) => {
      toast.success(
        result.kind === "blocked"
          ? "Время снова открыто для записи"
          : result.refunded
            ? `Отменено: ${terms.credit[0]} снова на балансе клиента`
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
                  {kindLabel(booking.kind, terms)}
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
