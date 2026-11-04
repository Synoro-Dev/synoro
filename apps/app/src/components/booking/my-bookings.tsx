"use client";

import type { RouterOutputs } from "@synoro/api";
import { paths } from "@synoro/config";
import {
  Button,
  Input,
  Progress,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@synoro/ui";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import { Badge } from "@synoro/ui/reui/badge";
import { Frame, FramePanel } from "@synoro/ui/reui/frame";
import {
  type CountForms,
  formatCredits,
  formatPhone,
  normalizePhone,
  type ProfessionTerms,
  pluralize,
  professionTerms,
} from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarCheckIcon,
  CalendarClockIcon,
  CalendarPlusIcon,
  CalendarSyncIcon,
  CalendarXIcon,
  HistoryIcon,
  PhoneIcon,
  ReceiptIcon,
  RepeatIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { orpc } from "~/orpc/react";
import {
  type BookingAction,
  BookingActionDialog,
} from "../client/booking-actions";
import { downloadIcs } from "../client/ics";
import { formatRub, PAYMENT_STATUS } from "../payment/format";
import { PaymentReturn } from "../payment/payment-return";
import { TopUpDialog } from "../payment/top-up-dialog";
import { MessengerCard } from "../settings/messenger-notifications";
import { useDisplayZone } from "./display-zone";
import { EmptyState, ErrorState } from "./states";
import { formatTime, viewerTimeZoneName } from "./time";
import { VideoLinkButton, VideoServiceName } from "./video-link";

type ClientPractice = RouterOutputs["practice"]["mine"][number];
type MyBooking = RouterOutputs["booking"]["mine"][number];
type MyPayment = RouterOutputs["payment"]["mine"][number];

/** The join button turns primary this long before the start. */
const JOIN_EARLY_MS = 15 * 60_000;

const DAY_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
};

/**
 * «Осталось 5 консультаций»; after 1, 21… the verb agrees with the noun:
 * осталась консультация, остался приём, осталось занятие.
 */
function remaining(count: number, forms: CountForms) {
  const word = pluralize(count, forms);
  let verb = "Осталось";
  if (word === forms[0] && /[ая]$/.test(word)) verb = "Осталась";
  else if (word === forms[0] && !/[оеё]$/.test(word)) verb = "Остался";
  return `${verb} ${count} ${word}`;
}

/** A day as a chip, in `timeZone` (the browser's when omitted). */
function DateChip({ at, timeZone }: { at: Date; timeZone?: string }) {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center rounded-md border bg-background py-1 leading-none">
      <span className="text-xs text-muted-foreground">
        {at.toLocaleDateString("ru-RU", { timeZone, month: "short" })}
      </span>
      <span className="text-lg font-semibold tabular-nums">
        {at.toLocaleDateString("ru-RU", { timeZone, day: "numeric" })}
      </span>
    </div>
  );
}

/**
 * The nearest booking, large: when (in the client's own zone), how, and
 * the three things one does with it — join, move, cancel — plus saving it
 * to the phone's calendar.
 */
function NextBooking({
  booking,
  timeZone,
  terms,
  onAction,
}: {
  booking: MyBooking;
  timeZone: string;
  terms: ProfessionTerms;
  onAction: (action: BookingAction) => void;
}) {
  const now = Date.now();
  const joinSoon =
    booking.startsAt.getTime() - now <= JOIN_EARLY_MS &&
    booking.endsAt.getTime() > now;

  return (
    <Frame spacing="lg">
      <FramePanel className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">
            Ближайшая запись
            {booking.kind === "free" && ` · ${terms.free}, бесплатно`}
          </span>
          <span className="text-lg font-medium first-letter:uppercase">
            {booking.startsAt.toLocaleDateString("ru-RU", {
              ...DAY_FORMAT,
              timeZone,
            })}
          </span>
          <span className="text-4xl font-semibold tracking-tight tabular-nums">
            {formatTime(booking.startsAt, timeZone)}–
            {formatTime(booking.endsAt, timeZone)}
          </span>
          <span className="text-sm text-muted-foreground">
            По вашему времени: {viewerTimeZoneName(timeZone)}
          </span>
        </div>

        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex gap-2">
            <dt className="w-24 shrink-0 text-muted-foreground">Специалист</dt>
            <dd className="min-w-0 font-medium">{booking.practiceName}</dd>
          </div>
          {booking.videoUrl && (
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">Формат</dt>
              <dd className="font-medium">
                Онлайн · <VideoServiceName url={booking.videoUrl} />
              </dd>
            </div>
          )}
          {booking.seriesId && (
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">Повтор</dt>
              <dd className="flex items-center gap-1.5 font-medium">
                <RepeatIcon className="size-3.5" aria-hidden="true" />
                Повторная запись
              </dd>
            </div>
          )}
        </dl>

        {booking.awaitingPayment ? (
          <Alert variant="warning">
            <CalendarClockIcon />
            <AlertTitle>Ждём подтверждения оплаты</AlertTitle>
            <AlertDescription>
              Как только банк подтвердит платёж, запись станет активной.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-2">
            {booking.videoUrl && (
              <VideoLinkButton
                url={booking.videoUrl}
                size="default"
                variant={joinSoon ? "default" : "outline"}
              />
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => onAction("move")}>
                <CalendarSyncIcon />
                Перенести
              </Button>
              <Button variant="outline" onClick={() => onAction("cancel")}>
                <CalendarXIcon />
                Отменить
              </Button>
            </div>
            <Button
              variant="ghost"
              onClick={() => downloadIcs(booking)}
              className="text-muted-foreground"
            >
              <CalendarPlusIcon />
              Добавить в календарь
            </Button>
          </div>
        )}
      </FramePanel>
    </Frame>
  );
}

/**
 * The balance in one practice: what is left, the last package for scale
 * when it is known, buying more and booking again.
 */
function Balance({
  practice,
  lastPackage,
  onTopUp,
}: {
  practice: ClientPractice;
  /** Credits of the last paid online package in this practice. */
  lastPackage: number | null;
  onTopUp: () => void;
}) {
  const offer = useQuery(
    orpc.payment.packages.queryOptions({
      input: { practiceId: practice.practiceId },
    }),
  );
  const canPay = offer.data?.enabled ?? false;
  const terms = professionTerms(practice.profession);
  const credits = practice.credits;
  const scale = lastPackage && credits <= lastPackage ? lastPackage : null;

  return (
    <Frame spacing="default">
      <FramePanel className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-base font-medium">
              {credits === 0
                ? `Оплаченных ${terms.credit[2]} нет`
                : remaining(credits, terms.credit)}
            </span>
            {scale && (
              <span className="text-sm text-muted-foreground tabular-nums">
                из {scale}
              </span>
            )}
          </div>
          {scale && (
            <Progress
              value={(credits / scale) * 100}
              aria-label={`${remaining(credits, terms.credit)} из ${scale}`}
              className="[&_[data-slot=progress-indicator]]:bg-brand"
            />
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            className="sm:flex-1"
            nativeButton={false}
            render={<Link href={paths.booking.public(practice.slug)} />}
          >
            <CalendarPlusIcon />
            Записаться
          </Button>
          {canPay && (
            <Button variant="outline" className="sm:flex-1" onClick={onTopUp}>
              <WalletIcon />
              Купить пакет
            </Button>
          )}
        </div>
        {!canPay && credits === 0 && offer.isSuccess && (
          <p className="text-sm text-muted-foreground">
            Онлайн-оплаты у специалиста нет. Оплатите {terms.credits}, как вы
            договорились, — специалист добавит их на баланс.
          </p>
        )}
      </FramePanel>
    </Frame>
  );
}

function BookingRows({
  bookings,
  timeZone,
  onAction,
}: {
  bookings: MyBooking[];
  timeZone: string;
  onAction?: (booking: MyBooking, action: BookingAction) => void;
}) {
  const now = Date.now();
  return (
    <Frame spacing="default" stacked>
      {bookings.map((b) => {
        const past = b.endsAt.getTime() <= now;
        return (
          <FramePanel key={b.id} className="flex items-center gap-3">
            <DateChip at={b.startsAt} timeZone={timeZone} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium tabular-nums">
                {formatTime(b.startsAt, timeZone)}–
                {formatTime(b.endsAt, timeZone)}
              </span>
              <span className="flex items-center gap-1 truncate text-sm text-muted-foreground">
                {b.seriesId && (
                  <RepeatIcon
                    className="size-3.5 shrink-0"
                    aria-label="Повторная запись"
                  />
                )}
                {b.kind === "free"
                  ? `${professionTerms(b.profession).free}, бесплатно`
                  : b.practiceName}
              </span>
            </div>
            {b.status === "cancelled" ? (
              <Badge
                variant={
                  b.cancelReason === "no_show" ? "warning-light" : "outline"
                }
              >
                {b.cancelReason === "no_show" ? "Неявка" : "Отменена"}
              </Badge>
            ) : past ? (
              <Badge variant="outline">Прошла</Badge>
            ) : b.awaitingPayment ? (
              <Badge variant="warning-light">Ждёт оплаты</Badge>
            ) : onAction ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAction(b, "cancel")}
              >
                Отменить
              </Button>
            ) : null}
          </FramePanel>
        );
      })}
    </Frame>
  );
}

const REASON = {
  purchase: "Пополнение",
  booking: "Запись",
  refund: "Возврат за отмену",
  adjustment: "Изменение от специалиста",
} as const;

/** The balance's journal in plain words, newest first. */
function BalanceJournal({
  memberId,
  bookings,
  timeZone,
}: {
  memberId: string;
  bookings: MyBooking[];
  timeZone: string;
}) {
  const history = useQuery(
    orpc.credit.history.queryOptions({ input: { memberId } }),
  );

  if (history.isError) {
    return <ErrorState onRetry={() => history.refetch()} />;
  }
  if (history.isPending) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }
  if (history.data.length === 0) {
    return (
      <EmptyState
        icon={HistoryIcon}
        title="Изменений баланса ещё не было"
        description="Здесь появятся пополнения, записи и возвраты."
      />
    );
  }

  const byId = new Map(bookings.map((b) => [b.id, b]));
  return (
    <Frame spacing="default" stacked>
      {history.data.map((entry) => {
        const booking = entry.bookingId ? byId.get(entry.bookingId) : null;
        return (
          <FramePanel key={entry.id} className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">
                {REASON[entry.reason]}
                {booking &&
                  ` на ${booking.startsAt.toLocaleDateString("ru-RU", {
                    timeZone,
                    day: "numeric",
                    month: "long",
                  })}`}
              </span>
              <span className="text-sm text-muted-foreground">
                {entry.createdAt.toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "long",
                  // The year only when it is not this one.
                  year:
                    entry.createdAt.getFullYear() === new Date().getFullYear()
                      ? undefined
                      : "numeric",
                })}
              </span>
            </div>
            <span
              className={
                entry.delta > 0
                  ? "font-medium text-brand-foreground tabular-nums"
                  : "font-medium text-muted-foreground tabular-nums"
              }
            >
              {entry.delta > 0 ? `+${entry.delta}` : `−${-entry.delta}`}
            </span>
          </FramePanel>
        );
      })}
    </Frame>
  );
}

function Payments({ payments }: { payments: MyPayment[] }) {
  if (payments.length === 0) {
    return (
      <EmptyState
        icon={ReceiptIcon}
        title="Онлайн-оплат не было"
        description="Когда вы купите пакет, платёж появится здесь."
      />
    );
  }
  return (
    <Frame spacing="default" stacked>
      {payments.map((p) => {
        const status = PAYMENT_STATUS[p.status];
        return (
          <FramePanel key={p.id} className="flex items-center gap-3">
            <DateChip at={p.createdAt} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-medium">
                {formatCredits(p.credits, professionTerms(p.profession))}
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {formatRub(p.amount)}
              </span>
            </div>
            {p.resumeUrl ? (
              <Button
                size="sm"
                nativeButton={false}
                render={<a href={p.resumeUrl} />}
              >
                Оплатить
              </Button>
            ) : (
              <Badge
                variant={p.status === "pending" ? "outline" : status.badge}
              >
                {p.status === "pending" ? "Не завершён" : status.label}
              </Badge>
            )}
          </FramePanel>
        );
      })}
    </Frame>
  );
}

/**
 * The phone the specialist calls about bookings. Accounts opened by an
 * emailed code start without one, and booking needs it: when missing, the
 * form shows at the top of the cabinet.
 */
function PhoneForm({ current }: { current: string | null }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState("");

  const save = useMutation({
    ...orpc.user.updatePhone.mutationOptions(),
    onSuccess: async () => {
      toast.success("Телефон сохранён");
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: orpc.user.key() });
    },
    onError: (error) => toast.error(error.message),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalized = normalizePhone(phone);
    if (!normalized) {
      toast.error("Укажите номер телефона, например +7 900 123-45-67");
      return;
    }
    save.mutate({ phone: normalized });
  }

  if (current && !editing) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <PhoneIcon className="size-4 text-muted-foreground" aria-hidden />
        <span className="flex-1 tabular-nums">{formatPhone(current)}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setPhone(current);
            setEditing(true);
          }}
        >
          Изменить
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
      <Input
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        aria-label="Телефон"
        placeholder="+7 900 123-45-67"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="h-11 sm:max-w-xs"
      />
      <Button type="submit" disabled={save.isPending}>
        Сохранить
      </Button>
      {editing && (
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
          Отмена
        </Button>
      )}
    </form>
  );
}

/**
 * The client's cabinet, one column for the phone: the nearest booking
 * large, the balance, then the journal. A client of several specialists
 * switches between them at the top.
 */
export function MyBookings() {
  // The zone picked on a booking page, else the browser's.
  const { zone } = useDisplayZone();
  const me = useQuery(orpc.user.me.queryOptions());
  const practices = useQuery(orpc.practice.mine.queryOptions());
  const bookings = useQuery(orpc.booking.mine.queryOptions());
  const payments = useQuery(orpc.payment.mine.queryOptions());
  const [picked, setPicked] = useState<string | null>(null);
  /** The practice whose package is being bought. */
  const [topUp, setTopUp] = useState<string | null>(null);
  const [acting, setActing] = useState<{
    booking: MyBooking;
    action: BookingAction;
  } | null>(null);

  const clientOf = practices.data?.filter((p) => p.role === "client") ?? [];
  const now = Date.now();
  const upcomingAll =
    bookings.data?.filter(
      (b) => b.status === "active" && b.endsAt.getTime() > now,
    ) ?? [];
  // Open on the specialist of the nearest booking.
  const practice =
    clientOf.find((p) => p.practiceId === picked) ??
    clientOf.find((p) => p.practiceId === upcomingAll[0]?.practiceId) ??
    clientOf[0];

  const topUpPractice = clientOf.find((p) => p.practiceId === topUp);
  // The nearest upcoming booking of each series: the only one that offers
  // cancelling the whole series.
  const seriesHeads = new Set<string>();
  const seenSeries = new Set<string>();
  for (const b of upcomingAll) {
    if (!b.seriesId || seenSeries.has(b.seriesId)) continue;
    seenSeries.add(b.seriesId);
    seriesHeads.add(b.id);
  }
  const mine = (bookings.data ?? []).filter(
    (b) => b.practiceId === practice?.practiceId,
  );
  const upcoming = upcomingAll.filter(
    (b) => b.practiceId === practice?.practiceId,
  );
  const [next, ...later] = upcoming;
  const past = mine
    .filter((b) => b.status !== "active" || b.endsAt.getTime() <= now)
    .reverse();
  const practicePayments = (payments.data ?? []).filter(
    (p) => p.practiceId === practice?.practiceId,
  );
  const lastPackage =
    practicePayments.find((p) => p.status === "succeeded")?.credits ?? null;
  const terms = professionTerms(practice?.profession ?? "other");

  if (practices.isError || bookings.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void practices.refetch();
          void bookings.refetch();
        }}
      />
    );
  }
  if (practices.isPending || bookings.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Мои записи</h1>

      {/* A failed payment is retried with its own specialist. */}
      <PaymentReturn
        onRetry={(practiceId) => {
          setPicked(practiceId);
          setTopUp(practiceId);
        }}
      />

      {me.data && !me.data.phone && (
        <Alert variant="warning">
          <PhoneIcon />
          <AlertTitle>Укажите телефон</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>
              Специалисту он нужен, чтобы связаться с вами по записи. Без
              телефона записаться нельзя.
            </span>
            <PhoneForm current={null} />
          </AlertDescription>
        </Alert>
      )}

      {clientOf.length > 1 && practice && (
        <ToggleGroup
          aria-label="Специалист"
          value={[practice.practiceId]}
          onValueChange={(value: string[]) => value[0] && setPicked(value[0])}
          variant="outline"
          spacing={2}
          className="flex-wrap justify-start"
        >
          {clientOf.map((p) => (
            <ToggleGroupItem
              key={p.practiceId}
              value={p.practiceId}
              className="min-h-11 px-4 data-pressed:border-brand data-pressed:bg-brand-soft data-pressed:text-brand-foreground"
            >
              {p.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}

      {!practice ? (
        <Frame spacing="default">
          <FramePanel>
            <EmptyState
              icon={CalendarCheckIcon}
              title="Записей пока нет"
              description="Откройте ссылку для записи, которую прислал специалист."
            />
          </FramePanel>
        </Frame>
      ) : (
        <>
          {next ? (
            <NextBooking
              booking={next}
              timeZone={zone}
              terms={terms}
              onAction={(action) => setActing({ booking: next, action })}
            />
          ) : (
            <Frame spacing="default">
              <FramePanel>
                <EmptyState
                  icon={CalendarCheckIcon}
                  title="Ближайших записей нет"
                  description="Выберите удобное время — это займёт минуту."
                />
              </FramePanel>
            </Frame>
          )}

          <Balance
            practice={practice}
            lastPackage={lastPackage}
            onTopUp={() => setTopUp(practice.practiceId)}
          />

          <Tabs defaultValue="bookings" className="gap-4">
            <TabsList className="w-full">
              <TabsTrigger value="bookings">Записи</TabsTrigger>
              <TabsTrigger value="balance">Баланс</TabsTrigger>
              <TabsTrigger value="payments">Платежи</TabsTrigger>
            </TabsList>
            <TabsContent value="bookings" className="flex flex-col gap-4">
              {later.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium text-muted-foreground">
                    Дальше
                  </h2>
                  <BookingRows
                    bookings={later}
                    timeZone={zone}
                    onAction={(booking, action) =>
                      setActing({ booking, action })
                    }
                  />
                </section>
              )}
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-medium text-muted-foreground">
                  За последние 30 дней
                </h2>
                {past.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Прошедших и отменённых записей нет.
                  </p>
                ) : (
                  <BookingRows bookings={past} timeZone={zone} />
                )}
              </section>
            </TabsContent>
            <TabsContent value="balance">
              <BalanceJournal
                memberId={practice.memberId}
                bookings={mine}
                timeZone={zone}
              />
            </TabsContent>
            <TabsContent value="payments">
              {payments.isError ? (
                <ErrorState onRetry={() => payments.refetch()} />
              ) : payments.isPending ? (
                <Skeleton className="h-40 w-full rounded-xl" />
              ) : (
                <Payments payments={practicePayments} />
              )}
            </TabsContent>
          </Tabs>
        </>
      )}

      {topUpPractice && (
        <TopUpDialog
          practice={{
            id: topUpPractice.practiceId,
            name: topUpPractice.name,
            profession: topUpPractice.profession,
          }}
          balance={topUpPractice.credits}
          open
          onOpenChange={(open) => !open && setTopUp(null)}
        />
      )}

      <section id="contacts" className="flex scroll-mt-20 flex-col gap-3">
        <h2 className="text-base font-medium">Контакты и уведомления</h2>
        {me.data?.phone && (
          <Frame spacing="default">
            <FramePanel>
              <PhoneForm current={me.data.phone} />
            </FramePanel>
          </Frame>
        )}
        <MessengerCard />
        {me.data && (
          <p className="text-sm text-muted-foreground">
            Письма о записях приходят на {me.data.email}.
          </p>
        )}
      </section>

      <BookingActionDialog
        booking={acting?.booking ?? null}
        action={acting?.action ?? "cancel"}
        balance={
          clientOf.find((p) => p.practiceId === acting?.booking.practiceId)
            ?.credits ?? 0
        }
        seriesHead={acting !== null && seriesHeads.has(acting.booking.id)}
        timeZone={zone}
        onClose={() => setActing(null)}
      />
    </div>
  );
}
