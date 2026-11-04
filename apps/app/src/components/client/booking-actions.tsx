"use client";

import type { RouterOutputs } from "@synoro/api";
import { paths } from "@synoro/config";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Spinner,
  toast,
} from "@synoro/ui";
import { Alert, AlertDescription } from "@synoro/ui/reui/alert";
import { formatCredits, professionTerms } from "@synoro/validators";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { formatDateTime } from "../booking/time";

type MyBooking = RouterOutputs["booking"]["mine"][number];

/** What the client is about to do with a booking. */
export type BookingAction = "cancel" | "move";

/**
 * Cancel or move one booking, with the consequence spelled out before the
 * second tap. Moving is cancel-then-rebook (there is no atomic move yet):
 * the dialog says so and opens the booking page once the server agrees.
 * Nothing changes on screen until the server confirms.
 */
export function BookingActionDialog({
  booking,
  action,
  balance,
  seriesHead,
  timeZone,
  onClose,
}: {
  booking: MyBooking | null;
  action: BookingAction;
  /**
   * The booking is the nearest upcoming one of its series. Only there may
   * the whole series go: `cancelSeries` cancels every upcoming booking of
   * it, earlier ones included.
   */
  seriesHead: boolean;
  /** The client's balance in the booking's practice. */
  balance: number;
  timeZone: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [wholeSeries, setWholeSeries] = useState(false);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.booking.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.practice.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.credit.key() }),
    ]);
  }

  const cancel = useMutation({
    ...orpc.booking.cancel.mutationOptions(),
    onSuccess: async (result) => {
      await refresh();
      if (action === "move" && booking) {
        toast.success("Запись отменена — выберите новое время");
        router.push(paths.booking.public(booking.practiceSlug));
      } else {
        toast.success(
          result.refunded
            ? "Запись отменена, оплата вернулась на баланс"
            : "Запись отменена",
        );
      }
      close();
    },
    onError: (error) => setFailure(error.message),
  });
  const cancelSeries = useMutation({
    ...orpc.booking.cancelSeries.mutationOptions(),
    onSuccess: async (result) => {
      await refresh();
      toast.success(
        result.kept > 0
          ? `Отменено записей: ${result.cancelled}. Ближайшую уже не отменить — до неё меньше 24 часов.`
          : `Отменено записей: ${result.cancelled}, оплата вернулась на баланс`,
      );
      close();
    },
    onError: (error) => setFailure(error.message),
  });

  function close() {
    setFailure(null);
    setWholeSeries(false);
    onClose();
  }

  const pending = cancel.isPending || cancelSeries.isPending;
  const terms = professionTerms(booking?.profession ?? "other");
  const free = booking?.kind === "free";
  const late = booking !== null && !booking.canCancel;

  return (
    <AlertDialog
      open={booking !== null}
      onOpenChange={(open) => !open && !pending && close()}
    >
      <AlertDialogContent>
        {booking && late ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {action === "move"
                  ? "Перенести уже нельзя"
                  : "Отменить уже нельзя"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                До начала меньше 24 часов. Изменить запись может только
                специалист — свяжитесь с ним так, как вы договаривались.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button onClick={close}>Понятно</Button>
            </AlertDialogFooter>
          </>
        ) : booking ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {action === "move" ? "Перенести запись?" : "Отменить запись?"}
              </AlertDialogTitle>
              <AlertDialogDescription className="flex flex-col gap-2">
                <span className="font-medium text-foreground first-letter:uppercase">
                  {formatDateTime(booking.startsAt, timeZone)}
                </span>
                <span>
                  {consequence({ action, free, balance, terms, wholeSeries })}
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            {action === "cancel" && booking.seriesId && seriesHead && (
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--brand)]"
                  checked={wholeSeries}
                  onChange={(e) => setWholeSeries(e.target.checked)}
                />
                Отменить всю повторную запись
              </label>
            )}
            {failure && (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            )}
            <AlertDialogFooter>
              <Button variant="outline" disabled={pending} onClick={close}>
                {action === "move" ? "Оставить как есть" : "Не отменять"}
              </Button>
              <Button
                variant={action === "move" ? "default" : "destructive"}
                disabled={pending}
                onClick={() => {
                  setFailure(null);
                  if (wholeSeries && booking.seriesId) {
                    cancelSeries.mutate({ seriesId: booking.seriesId });
                  } else {
                    cancel.mutate({ bookingId: booking.id });
                  }
                }}
              >
                {pending && <Spinner />}
                {action === "move" ? "Выбрать новое время" : "Отменить запись"}
              </Button>
            </AlertDialogFooter>
          </>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function consequence({
  action,
  free,
  balance,
  terms,
  wholeSeries,
}: {
  action: BookingAction;
  free: boolean;
  balance: number;
  terms: ReturnType<typeof professionTerms>;
  wholeSeries: boolean;
}) {
  if (action === "move") {
    return free
      ? "Эта запись отменится, и откроется выбор нового времени. Текущее время сразу станет доступно другим."
      : `Эта запись отменится, оплата вернётся на баланс, и откроется выбор нового времени. Текущее время сразу станет доступно другим.`;
  }
  if (free) return "Время освободится для других.";
  if (wholeSeries) {
    return "Оплата за записи, до которых больше 24 часов, вернётся на баланс.";
  }
  return `Оплата вернётся на баланс — на нём станет ${formatCredits(balance + 1, terms)}.`;
}
