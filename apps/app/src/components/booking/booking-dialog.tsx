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
import {
  capitalize,
  formatPhone,
  type ProfessionTerms,
} from "@synoro/validators";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Clock3Icon,
  LockIcon,
  MailIcon,
  PhoneIcon,
  RepeatIcon,
  StickyNoteIcon,
  UserRoundIcon,
  UserRoundXIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { orpc } from "~/orpc/react";
import { ConfirmButton } from "./confirm-button";
import { useTerms } from "./terms";
import { formatDateTime, formatTime } from "./time";
import { VideoLinkButton, VideoLinkForm, VideoServiceName } from "./video-link";

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

/**
 * The video link of one booking. Without its own link a booking uses the
 * practice's room; saving here replaces it for this booking only, and the
 * client of a paid consultation is mailed the link they now have.
 */
function MeetingLink({
  booking,
  onSaved,
}: {
  booking: CalendarBooking;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useMutation({
    ...orpc.booking.setMeetingUrl.mutationOptions(),
    onSuccess: async (result) => {
      toast.success(
        result.meetingUrl && booking.kind === "consultation"
          ? "Ссылка сохранена, клиенту отправлено письмо"
          : "Ссылка сохранена",
      );
      await queryClient.invalidateQueries({ queryKey: orpc.booking.key() });
      onSaved();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          Видеовстреча
          {booking.videoUrl && (
            <span className="font-normal text-muted-foreground">
              {" "}
              · <VideoServiceName url={booking.videoUrl} />
            </span>
          )}
        </span>
        {booking.videoUrl && (
          <VideoLinkButton url={booking.videoUrl} variant="outline" />
        )}
      </div>
      <VideoLinkForm
        key={booking.id}
        label="Ссылка на эту встречу"
        placeholder="https://company.ktalk.ru/room"
        value={booking.meetingUrl}
        pending={save.isPending}
        onSave={(url) =>
          save.mutate({ bookingId: booking.id, meetingUrl: url })
        }
      />
      <p className="text-xs text-muted-foreground">
        {booking.meetingUrl
          ? "Своя ссылка этой встречи. Очистите поле, чтобы вернуть комнату практики."
          : booking.videoUrl
            ? "Используется комната практики. Укажите ссылку, чтобы заменить её для этой встречи."
            : "Ссылка не задана — клиент её не увидит. Комнату для всех встреч можно задать на странице обзора."}
        {booking.kind === "free" &&
          " Гостю ссылку нужно отправить самостоятельно."}
      </p>
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
  const noShow = useMutation({
    ...orpc.booking.markNoShow.mutationOptions(),
    onSuccess: async () => {
      toast.success(`Отмечена неявка: ${terms.credit[0]} не возвращается`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.booking.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.practice.key() }),
      ]);
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  const cancelSeries = useMutation({
    ...orpc.booking.cancelSeries.mutationOptions(),
    onSuccess: async (result) => {
      toast.success(
        `Серия отменена: ${result.cancelled}, вернулось на баланс: ${result.refunded}`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.booking.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.practice.key() }),
      ]);
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });
  const pending =
    cancel.isPending || noShow.isPending || cancelSeries.isPending;
  // A no-show is marked once the booking has started; unpaid holds never.
  const started =
    booking !== null &&
    booking.kind === "consultation" &&
    booking.holdUntil === null &&
    booking.startsAt.getTime() <= Date.now();

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
                {booking.holdUntil && (
                  <Badge variant="warning-light">Ждёт оплаты</Badge>
                )}
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
              {booking.kind !== "blocked" &&
                (booking.guestPhone ?? booking.clientPhone) && (
                  <Fact icon={<PhoneIcon />}>
                    <a
                      href={`tel:${booking.guestPhone ?? booking.clientPhone}`}
                      className="hover:underline"
                    >
                      {formatPhone(
                        booking.guestPhone ?? booking.clientPhone ?? "",
                      )}
                    </a>
                  </Fact>
                )}
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
              {booking.seriesId && (
                <Fact icon={<RepeatIcon />}>Повторная запись</Fact>
              )}
            </div>

            {booking.kind !== "blocked" && (
              <MeetingLink booking={booking} onSaved={onClose} />
            )}

            <DialogFooter className="flex-wrap">
              {booking.seriesId && (
                <ConfirmButton
                  size="default"
                  title="Отменить серию?"
                  description={`Отменятся все предстоящие записи этой повторной записи, ${terms.credits} вернутся на баланс клиента.`}
                  confirmLabel="Отменить серию"
                  disabled={pending}
                  onConfirm={() =>
                    booking.seriesId &&
                    cancelSeries.mutate({ seriesId: booking.seriesId })
                  }
                >
                  <RepeatIcon />
                  Отменить серию
                </ConfirmButton>
              )}
              {started && (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => noShow.mutate({ bookingId: booking.id })}
                >
                  <UserRoundXIcon />
                  Клиент не пришёл
                </Button>
              )}
              {booking.kind === "consultation" && (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    cancel.mutate({ bookingId: booking.id, refund: false })
                  }
                >
                  Без возврата
                </Button>
              )}
              <Button
                variant={booking.kind === "blocked" ? "default" : "destructive"}
                disabled={pending}
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
