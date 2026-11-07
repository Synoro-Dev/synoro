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
  CalendarSyncIcon,
  ClipboardListIcon,
  Clock3Icon,
  LockIcon,
  MailIcon,
  PhoneIcon,
  RepeatIcon,
  StickyNoteIcon,
  UserRoundIcon,
  UserRoundXIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { orpc } from "~/orpc/react";
import { ConfirmButton } from "./confirm-button";
import { SlotPicker } from "./slot-picker";
import { useTerms } from "./terms";
import { formatDateTime, formatTime } from "./time";
import { VideoLinkButton, VideoLinkForm, VideoServiceName } from "./video-link";

export type CalendarBooking = RouterOutputs["booking"]["calendar"][number];

/**
 * Calm, distinct looks per kind: paid bookings carry the accent, free
 * ones a quiet blue, closed time stays grey. Labels always go with them.
 */
export const KIND_META = {
  consultation: { badge: "success-light", color: "var(--brand)" },
  free: { badge: "info-light", color: "var(--calendar-free)" },
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
  // A consultation brought in from a calendar has a name, but no account.
  if (b.kind === "consultation") {
    return b.clientName ?? b.guestName ?? "Клиент удалён";
  }
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
        result.meetingUrl && booking.kind === "consultation" && booking.memberId
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
        {!booking.memberId &&
          (booking.kind === "free"
            ? " Гостю ссылку нужно отправить самостоятельно."
            : " Клиенту ссылку нужно отправить самостоятельно: у него нет кабинета.")}
      </p>
    </div>
  );
}

/**
 * Staff move a booking to another free time; the 24-hour rule is the client's
 * only. Times read in the viewer's own zone, like the calendar. The booking
 * stays where it is if the time was taken meanwhile.
 */
function MoveBooking({
  booking,
  onBack,
  onMoved,
}: {
  booking: CalendarBooking;
  onBack: () => void;
  onMoved: () => void;
}) {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<Date | null>(null);
  const move = useMutation({
    ...orpc.booking.reschedule.mutationOptions(),
    onSuccess: async () => {
      // Mails are best effort: nothing here knows that the client got one.
      toast.success(
        booking.memberId
          ? "Запись перенесена"
          : "Запись перенесена — сообщите гостю новое время",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.booking.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.practice.key() }),
      ]);
      onMoved();
    },
    onError: async (error) => {
      toast.error(error.message);
      setPicked(null);
      await queryClient.invalidateQueries({ queryKey: orpc.booking.key() });
    },
  });

  return (
    <>
      <SlotPicker
        bookingId={booking.id}
        selected={picked}
        onSelect={setPicked}
        disabled={move.isPending}
      />
      <DialogFooter className="flex-wrap">
        <Button variant="outline" disabled={move.isPending} onClick={onBack}>
          Назад
        </Button>
        <Button
          disabled={move.isPending || !picked}
          onClick={() =>
            picked && move.mutate({ bookingId: booking.id, startsAt: picked })
          }
        >
          {picked ? `Перенести на ${formatDateTime(picked)}` : "Перенести"}
        </Button>
      </DialogFooter>
    </>
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
  /** The booking whose new time is being picked. */
  const [movingId, setMovingId] = useState<string | null>(null);
  // Unpaid holds aren't bookings yet; closed time is opened and closed anew.
  const movable =
    booking !== null && booking.kind !== "blocked" && !booking.holdUntil;
  const moving = movable && movingId === booking.id;
  // Something was taken from a client's balance and can be given back.
  const charged =
    booking !== null &&
    booking.kind === "consultation" &&
    booking.memberId !== null &&
    booking.credits > 0;

  function close() {
    setMovingId(null);
    onClose();
  }

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
      // A booking brought in by an import spent nothing, so nothing returns.
      toast.success(
        booking?.memberId
          ? `Отмечена неявка: ${terms.credit[0]} не возвращается`
          : "Отмечена неявка",
      );
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
    <Dialog open={booking !== null} onOpenChange={(open) => !open && close()}>
      {/* Long questionnaire answers can outgrow the screen: scroll. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
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
          </>
        )}
        {booking && moving && (
          <MoveBooking
            // A new booking starts its own pick.
            key={booking.id}
            booking={booking}
            onBack={() => setMovingId(null)}
            onMoved={close}
          />
        )}
        {booking && !moving && (
          <>
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
              {booking.kind !== "blocked" && booking.clientEmail && (
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

            {booking.answers && booking.answers.length > 0 && (
              <section className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
                <h3 className="flex items-center gap-2 text-sm font-medium">
                  <ClipboardListIcon className="size-4 text-muted-foreground" />
                  Анкета
                </h3>
                <dl className="flex flex-col gap-2 text-sm">
                  {booking.answers.map((item) => (
                    <div key={item.question} className="flex flex-col gap-0.5">
                      <dt className="text-muted-foreground">{item.question}</dt>
                      <dd className="whitespace-pre-line break-words">
                        {item.answer}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {booking.kind !== "blocked" && (
              <MeetingLink booking={booking} onSaved={onClose} />
            )}

            <DialogFooter className="flex-wrap">
              {movable && (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => setMovingId(booking.id)}
                >
                  <CalendarSyncIcon />
                  Перенести
                </Button>
              )}
              {booking.seriesId && (
                <ConfirmButton
                  size="default"
                  title="Отменить серию?"
                  description={
                    charged
                      ? `Отменятся все предстоящие записи этой повторной записи, ${terms.credits} вернутся на баланс клиента.`
                      : "Отменятся все предстоящие записи этой повторной записи."
                  }
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
              {charged && (
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
                  : charged
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
