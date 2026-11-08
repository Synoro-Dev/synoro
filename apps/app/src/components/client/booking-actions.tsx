"use client";

import { isDefinedError } from "@orpc/client";
import type { RouterOutputs } from "@synoro/api";
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
import {
  formatCredits,
  formatHoursLess,
  professionTerms,
} from "@synoro/validators";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon } from "lucide-react";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import { SlotPicker } from "../booking/slot-picker";
import { formatDateTime, viewerTimeZoneName } from "../booking/time";

type MyBooking = RouterOutputs["booking"]["mine"][number];

/** What the client is about to do with a booking. */
export type BookingAction = "cancel" | "move";

/**
 * Cancel or move one booking, with the consequence spelled out before the
 * second tap. Moving picks a new time among the free ones; the booking stays
 * where it is until the server has moved it, and stays there if the time was
 * taken meanwhile. Nothing changes on screen until the server confirms.
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
  const [failure, setFailure] = useState<string | null>(null);
  const [wholeSeries, setWholeSeries] = useState(false);
  /** The new time being picked. */
  const [picked, setPicked] = useState<Date | null>(null);

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
      toast.success(
        result.refunded
          ? "Запись отменена, оплата вернулась на баланс"
          : "Запись отменена",
      );
      close();
    },
    onError: (error) => setFailure(error.message),
  });
  const move = useMutation({
    ...orpc.booking.reschedule.mutationOptions(),
    onSuccess: async (result) => {
      await refresh();
      toast.success(
        `Запись перенесена: ${formatDateTime(result.startsAt, timeZone)}`,
      );
      close();
    },
    onError: async (error) => {
      setFailure(error.message);
      // Someone took the time: the list shows what is free now.
      if (isDefinedError(error) && error.code === "SLOT_UNAVAILABLE") {
        setPicked(null);
      }
      await refresh();
    },
  });
  const cancelSeries = useMutation({
    ...orpc.booking.cancelSeries.mutationOptions(),
    onSuccess: async (result) => {
      await refresh();
      toast.success(
        result.kept > 0
          ? `Отменено записей: ${result.cancelled}. Ближайшая осталась — до неё ${formatHoursLess(result.cancelHours)}.`
          : free
            ? `Отменено записей: ${result.cancelled}`
            : `Отменено записей: ${result.cancelled}, оплата вернулась на баланс`,
      );
      close();
    },
    onError: (error) => setFailure(error.message),
  });

  function close() {
    setFailure(null);
    setWholeSeries(false);
    setPicked(null);
    onClose();
  }

  const pending = cancel.isPending || cancelSeries.isPending || move.isPending;
  const terms = professionTerms(booking?.profession ?? "other");
  // Nothing was taken for it (an intro, paid at the visit): no balance to name.
  const free = booking !== null && !booking.charged;
  // Too late to do it alone: a move needs the credit to be refundable.
  const late =
    booking !== null &&
    !(action === "move" ? booking.canMove : booking.canCancel);
  /** Cancelling now loses the credit (the practice allows late cancels). */
  const forfeit = booking !== null && action === "cancel" && booking.lateCancel;

  return (
    <AlertDialog
      open={booking !== null}
      onOpenChange={(open) => !open && !pending && close()}
    >
      {/* The time picker can outgrow a small screen: scroll. */}
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        {booking && late ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {action === "move"
                  ? "Перенести уже нельзя"
                  : "Отменить уже нельзя"}
              </AlertDialogTitle>
              <AlertDialogDescription className="flex flex-col gap-2">
                {booking.contact ? (
                  <>
                    <span>
                      До начала {formatHoursLess(booking.cancelHours)}. Изменить
                      запись может только специалист. Как связаться:
                    </span>
                    <span className="font-medium break-words text-foreground">
                      {booking.contact}
                    </span>
                  </>
                ) : (
                  <span>
                    До начала {formatHoursLess(booking.cancelHours)}. Изменить
                    запись может только специалист — свяжитесь с ним так, как вы
                    договаривались.
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button onClick={close}>Понятно</Button>
            </AlertDialogFooter>
          </>
        ) : booking && action === "move" ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Перенести запись</AlertDialogTitle>
              <AlertDialogDescription className="flex flex-col gap-1">
                <span>
                  Сейчас: {formatDateTime(booking.startsAt, timeZone)}
                </span>
                <span>
                  Выберите новое время. Время указано по вашему поясу:{" "}
                  {viewerTimeZoneName(timeZone)}.
                  {free ? "" : " Баланс не изменится."}
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <SlotPicker
              bookingId={booking.id}
              timeZone={timeZone}
              selected={picked}
              onSelect={setPicked}
              disabled={pending}
            />
            {failure && (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            )}
            <AlertDialogFooter>
              <Button variant="outline" disabled={pending} onClick={close}>
                Оставить как есть
              </Button>
              <Button
                disabled={pending || !picked}
                onClick={() => {
                  if (!picked) return;
                  setFailure(null);
                  move.mutate({
                    bookingId: booking.id,
                    startsAt: picked,
                    timezone: timeZone,
                  });
                }}
              >
                {move.isPending && <Spinner />}
                {picked
                  ? `Перенести на ${formatDateTime(picked, timeZone)}`
                  : "Перенести"}
              </Button>
            </AlertDialogFooter>
          </>
        ) : booking ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {forfeit ? "Отменить без возврата?" : "Отменить запись?"}
              </AlertDialogTitle>
              <AlertDialogDescription className="flex flex-col gap-2">
                <span className="font-medium text-foreground first-letter:uppercase">
                  {formatDateTime(booking.startsAt, timeZone)}
                </span>
                <span>
                  {forfeit
                    ? `До начала ${formatHoursLess(booking.cancelHours)}: по правилам специалиста на баланс не вернётся ${formatCredits(booking.credits, terms)}. Время освободится для других.`
                    : consequence({
                        free,
                        balance,
                        credits: booking.credits,
                        cancelHours: booking.cancelHours,
                        terms,
                        wholeSeries,
                      })}
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            {booking.seriesId && seriesHead && !forfeit && (
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
                Не отменять
              </Button>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => {
                  setFailure(null);
                  if (wholeSeries && booking.seriesId) {
                    cancelSeries.mutate({ seriesId: booking.seriesId });
                  } else {
                    cancel.mutate({ bookingId: booking.id, forfeit });
                  }
                }}
              >
                {pending && <Spinner />}
                {forfeit ? "Отменить без возврата" : "Отменить запись"}
              </Button>
            </AlertDialogFooter>
          </>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function consequence({
  free,
  balance,
  credits,
  cancelHours,
  terms,
  wholeSeries,
}: {
  free: boolean;
  balance: number;
  /** What the booking took: a service may cost more than one. */
  credits: number;
  cancelHours: number;
  terms: ReturnType<typeof professionTerms>;
  wholeSeries: boolean;
}) {
  if (free) return "Время освободится для других.";
  if (wholeSeries) {
    return `Оплата вернётся на баланс за записи, до начала которых не ${formatHoursLess(cancelHours)}.`;
  }
  return `Оплата вернётся на баланс — на нём станет ${formatCredits(balance + credits, terms)}.`;
}
