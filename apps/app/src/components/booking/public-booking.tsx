"use client";

import { isDefinedError } from "@orpc/client";
import type { RouterOutputs } from "@synoro/api";
import { paths } from "@synoro/config";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Calendar,
  cn,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@synoro/ui";
import { useIsMobile } from "@synoro/ui/hooks";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import { Badge } from "@synoro/ui/reui/badge";
import { IconTile } from "@synoro/ui/reui/icon-tile";
import {
  capitalize,
  checkBookingAnswers,
  formatCredits,
  formatMinutes,
  normalizePhone,
  professionTerms,
} from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import {
  CalendarCheckIcon,
  CalendarDaysIcon,
  CalendarRangeIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  Columns3Icon,
  GiftIcon,
  GlobeIcon,
  LogInIcon,
  RepeatIcon,
  UndoDotIcon,
  WalletIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

import { LegalFooter } from "~/components/legal-links";
import { reportFrameHeight } from "~/lib/embed";
import { orpc } from "~/orpc/react";
import { TopUpDialog } from "../payment/top-up-dialog";
import { BookingQuestionFields } from "./booking-question-fields";
import { bookingThemeAttributes } from "./booking-theme";
import { BookingTicket } from "./booking-ticket";
import {
  addDays,
  type BookingView,
  formatWeekRange,
  isBookingView,
  weekDays,
  weekStart,
  weekWindow,
} from "./booking-views";
import { WeekColumns, WeekGrid, WeekSkeleton } from "./booking-week";
import { displayFonts } from "./display-font";
import { useDisplayZone } from "./display-zone";
import { GuestBookingForm } from "./guest-booking-form";
import { IntroBookingForm } from "./intro-booking-form";
import { SeriesDialog } from "./series-dialog";
import { ErrorState } from "./states";
import { SynoroBadge } from "./synoro-badge";
import {
  clockIn,
  dateKey,
  formatDateTime,
  formatTime,
  viewerTimeZoneName,
} from "./time";
import { TimeZoneSelect } from "./time-zone-select";
import { WaitlistRow } from "./waitlist-dialog";

type PublicPractice = RouterOutputs["practice"]["bySlug"];
type Slot = { startsAt: Date; endsAt: Date };
type Kind = "consultation" | "free";

/** From today (or the 1st) to month end, with two days of padding each side. */
function monthWindow(month: Date, today: string) {
  const first = dateKey(new Date(month.getFullYear(), month.getMonth(), 1));
  const last = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const from = new Date(
    Date.parse(`${first < today ? today : first}T00:00:00Z`) - 2 * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  const days =
    Math.round(
      (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000,
    ) + 3;
  return { from, days: Math.max(1, Math.min(35, days)) };
}

const keyToDate = (key: string) => new Date(`${key}T12:00:00`);

/** Where the visitor's chosen view is remembered, per browser. */
const VIEW_STORAGE_KEY = "synoro:booking-view";

function readStoredView(): BookingView {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    if (isBookingView(stored)) return stored;
  } catch {
    // Storage is blocked (private mode, an iframe): the month it is.
  }
  return "month";
}
const monthView = (): BookingView => "month";
// Read once per render: the choice is changed on this page only.
const noStore = () => () => {};
const yes = () => true;
const no = () => false;

/** Parts of the day the free times are grouped by, in the viewer's zone. */
const DAY_PARTS = [
  { label: "Утро", until: 12 },
  { label: "День", until: 17 },
  { label: "Вечер", until: 24 },
] as const;

function byDayPart(slots: Slot[], timeZone: string) {
  return DAY_PARTS.map((part, index) => ({
    label: part.label,
    slots: slots.filter((slot) => {
      const { hour } = clockIn(slot.startsAt, timeZone);
      const from = DAY_PARTS[index - 1]?.until ?? 0;
      return hour >= from && hour < part.until;
    }),
  })).filter((part) => part.slots.length > 0);
}

/** «Анна Иванова» → «АИ», for the photo's place when there is none. */
function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      // The first code point: `charAt` would split an emoji's surrogate pair.
      .map((word) => Array.from(word)[0] ?? "")
      .join("")
      .toUpperCase()
  );
}

/**
 * The booking page: the specialist up top, then one panel with a month of
 * bookable days and the free hours of the chosen day. Picking an hour turns
 * the panel into a ticket (the time, large) beside the booking form.
 *
 * A visitor needs no account: with online payment connected they pick a time,
 * leave name, phone and email and pay (`GuestBookingForm`). A signed-in client
 * books from their balance, one paid credit per hour. When the owner allows
 * it (`freeBooking`), a tab switches to the free 30-minute intro, booked by
 * anyone once, without payment (`IntroBookingForm`).
 */
export function PublicBooking({
  practice,
  signedIn,
  bookingUrl,
}: {
  practice: PublicPractice;
  signedIn: boolean;
  /**
   * Set on the practice's own host: sign-in happens on the app host, so the
   * call to action leads to this page there instead of the login form.
   */
  bookingUrl?: string;
}) {
  const queryClient = useQueryClient();
  const terms = professionTerms(practice.profession);
  const what = capitalize(terms.credit[0]);
  const today = dateKey(new Date(), practice.timezone);
  // Times are shown in the zone the visitor picked, else their browser's.
  const { zone, browserZone, setZone } = useDisplayZone();
  const viewerToday = dateKey(new Date(), zone);
  const [month, setMonth] = useState(() => keyToDate(today));
  /** The view picked on this visit; until then the one remembered. */
  const [chosenView, setChosenView] = useState<BookingView | null>(null);
  const storedView = useSyncExternalStore(noStore, readStoredView, monthView);
  const view = chosenView ?? storedView;
  // The server knows no stored view: slots wait for the browser's.
  const hydrated = useSyncExternalStore(noStore, yes, no);
  /** The Monday of the week shown by the week and column views. */
  const [week, setWeek] = useState(() => weekStart(viewerToday));
  // A week of seven columns doesn't fit a phone: there it is the month.
  const isMobile = useIsMobile();
  const shown: BookingView = isMobile ? "month" : view;
  /** The layout `month` / `week` were last lined up for. */
  const [laidOut, setLaidOut] = useState(shown);
  const [day, setDay] = useState<string | null>(null);
  const [picked, setPicked] = useState<Slot | null>(null);
  const [booked, setBooked] = useState<Date | null>(null);
  /** The free intro just booked: its time and the link to it. */
  const [bookedIntro, setBookedIntro] = useState<{
    token: string;
    startsAt: Date;
    endsAt: Date;
  } | null>(null);
  const [chosenKind, setChosenKind] = useState<Kind | null>(null);
  /** The service picked on this visit; the first one until then. */
  const [chosenServiceId, setChosenServiceId] = useState<string | null>(null);
  /** How long the last booking is, for «Вы записаны». */
  const [bookedMinutes, setBookedMinutes] = useState(60);
  /** How many bookings the last booking made: more than one for a series. */
  const [bookedCount, setBookedCount] = useState(1);
  const [seriesFrom, setSeriesFrom] = useState<Date | null>(null);
  const [topUp, setTopUp] = useState(false);
  const [phone, setPhone] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const panel = useRef<HTMLDivElement>(null);

  const { data: info } = useQuery({
    ...orpc.practice.bySlug.queryOptions({ input: { slug: practice.slug } }),
    initialData: practice,
  });
  // What is booked: the picked service, else the first one; a practice
  // without services books an hour for one credit.
  const services = info.services;
  const service = services.find((s) => s.id === chosenServiceId) ?? services[0];
  const price = service?.credits ?? 1;
  const serviceMinutes = service?.minutes ?? 60;
  // Staff see their own page as a preview; only clients book here.
  const isStaff = !!info.membership && info.membership.role !== "client";
  const membership = isStaff ? null : info.membership;
  const credits = membership?.credits ?? 0;
  const canBook = !!membership && credits >= price;
  const offer = useQuery({
    ...orpc.payment.packages.queryOptions({
      input: { practiceId: practice.id },
    }),
    enabled: !isStaff,
  });
  const canPay = offer.data?.enabled ?? false;
  // Visitors without an account book and pay in one go.
  const guestFlow = !signedIn && canPay;
  const me = useQuery({
    ...orpc.user.me.queryOptions(),
    enabled: signedIn && !isStaff,
  });
  const needsPhone = !!me.data && !me.data.phone;
  const { questions } = info;
  const introLength = formatMinutes(info.introMinutes);
  // Paid hours first; the intro when nothing else can be booked here.
  const kind: Kind = !info.freeBooking
    ? "consultation"
    : (chosenKind ??
      (offer.isSuccess && !canPay && !canBook ? "free" : "consultation"));
  const intro = kind === "free";

  // Dialogs and popovers render outside <main>: the whole document takes the
  // page's accent and corners while it is open.
  const { accent, radius } = info.theme;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.bookingAccent = accent;
    root.dataset.bookingRadius = radius;
    return () => {
      delete root.dataset.bookingAccent;
      delete root.dataset.bookingRadius;
    };
  }, [accent, radius]);

  /** The questionnaire is filled in; otherwise its errors are shown. */
  function answered() {
    const { errors } = checkBookingAnswers(questions, answers);
    setAnswerErrors(errors);
    if (Object.keys(errors).length === 0) return true;
    toast.error("Ответьте на вопросы анкеты");
    return false;
  }

  /** Opens or closes the booking form for a time. */
  function choose(slot: Slot | null) {
    flushSync(() => setPicked(slot));
    // The pressed button is gone with the swap: keep keyboard and screen
    // reader users in the panel.
    panel.current?.focus({ preventScroll: true });
    // On a phone the times end below the fold: start the swapped panel from
    // its top.
    const top = panel.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) panel.current?.scrollIntoView({ block: "start" });
  }

  if (shown !== laidOut) {
    // The width switched the layout (a turned phone, a narrowed window): keep
    // the open booking form, or else the days that were in view, on screen.
    setLaidOut(shown);
    const anchor = picked
      ? dateKey(picked.startsAt, zone)
      : shown === "month"
        ? (weekDays(week).find((key) => key >= viewerToday) ?? week)
        : (day ?? viewerToday);
    setMonth(keyToDate(anchor));
    setWeek(weekStart(anchor));
    if (shown === "month") setDay(anchor);
  }

  const monthStart = dateKey(
    new Date(month.getFullYear(), month.getMonth(), 1),
  );
  const monthEnd = dateKey(
    new Date(month.getFullYear(), month.getMonth() + 1, 0),
  );
  const [rangeStart, rangeEnd] =
    shown === "month" ? [monthStart, monthEnd] : [week, addDays(week, 6)];
  const range =
    shown === "month" ? monthWindow(month, today) : weekWindow(week, today);
  const slots = useQuery({
    ...orpc.booking.slots.queryOptions({
      input: {
        practiceId: practice.id,
        from: range.from,
        days: range.days,
        kind,
        serviceId: kind === "consultation" ? service?.id : undefined,
      },
    }),
    placeholderData: (previous) => previous,
    // Not the month's slots for a visitor who reads the week.
    enabled: hydrated,
  });

  const byDay = new Map<string, Slot[]>();
  for (const slot of slots.data?.slots ?? []) {
    const key = dateKey(slot.startsAt, zone);
    if (key < rangeStart || key > rangeEnd || key < viewerToday) continue;
    byDay.set(key, [...(byDay.get(key) ?? []), slot]);
  }
  // Default to the first day with free time once slots arrive.
  const firstFree = [...byDay.keys()].sort()[0] ?? null;
  const selectedDay = day && byDay.has(day) ? day : firstFree;
  const daySlots = selectedDay ? (byDay.get(selectedDay) ?? []) : [];
  const slotsDisabled =
    // Times of the other tab (or range) while these load: an hour is not a
    // half hour.
    slots.isPlaceholderData || (intro ? isStaff : !canBook && !guestFlow);

  /** Switches the layout, keeping the visitor on the same days. */
  function changeView(next: BookingView) {
    if (shown === "month" && next !== "month") {
      setWeek(weekStart(selectedDay ?? viewerToday));
    } else if (shown !== "month" && next === "month") {
      setMonth(
        keyToDate(
          firstFree ?? weekDays(week).find((key) => key >= viewerToday) ?? week,
        ),
      );
      setDay(firstFree);
    }
    setChosenView(next);
    setLaidOut(next);
    setPicked(null);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Not remembered: the next visit starts from the month.
    }
  }

  /** The same hours, read in another zone: the days shift, so start over. */
  function changeZone(next: string) {
    setZone(next);
    setWeek(weekStart(dateKey(new Date(), next)));
    setDay(null);
    setPicked(null);
  }

  function moveWeek(days: number) {
    setWeek(addDays(week, days));
    setPicked(null);
  }

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.booking.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.practice.key() }),
    ]);

  const join = useMutation({
    ...orpc.practice.join.mutationOptions(),
    onSuccess: async () => {
      toast.success(
        `Вы клиент. Администратор добавит оплаченные ${terms.credits}.`,
      );
      await refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  const savePhone = useMutation({
    ...orpc.user.updatePhone.mutationOptions(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orpc.user.key() }),
    onError: (error) => toast.error(error.message),
  });

  const book = useMutation({
    ...orpc.booking.book.mutationOptions(),
    onSuccess: async (booking) => {
      setBooked(booking.startsAt);
      setBookedCount(1);
      setBookedMinutes(
        (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000,
      );
      setPicked(null);
      setAnswers({});
      await refresh();
    },
    onError: async (error) => {
      // NO_CREDITS / SLOT_UNAVAILABLE carry a user-facing message.
      toast.error(error.message || "Не удалось записаться");
      if (isDefinedError(error) && error.code === "ANSWERS_INVALID") {
        // The questionnaire changed meanwhile: keep the time, show the fields.
        setAnswerErrors(error.data.errors);
        await refresh();
        return;
      }
      setPicked(null);
      await refresh();
    },
  });

  async function confirm(slot: Slot) {
    if (!answered()) return;
    if (needsPhone) {
      const normalized = normalizePhone(phone);
      if (!normalized) {
        toast.error("Укажите номер телефона, например +7 900 123-45-67");
        return;
      }
      await savePhone.mutateAsync({ phone: normalized });
    }
    book.mutate({
      practiceId: practice.id,
      startsAt: slot.startsAt,
      serviceId: service?.id,
      answers,
      timezone: zone,
    });
  }

  // The client's own cabinet; on the practice's host it lives on the app host.
  const cabinet = bookingUrl ? (
    // biome-ignore lint/a11y/useAnchorContent: Button renders the children.
    <a href={bookingUrl} />
  ) : (
    // `_top`: the sign-in page can't open inside an iframe.
    <Link href={paths.auth.login} target="_top" />
  );
  // Someone else may take the time while the form is open: once the refreshed
  // list no longer has it, the form closes and says so.
  const pickedFree =
    !!picked &&
    (byDay.get(dateKey(picked.startsAt, zone)) ?? []).some(
      (slot) => slot.startsAt.getTime() === picked.startsAt.getTime(),
    );
  const checkout =
    picked &&
    pickedFree &&
    (intro ? !isStaff : guestFlow ? !!offer.data : canBook);

  // What stands between the visitor and booking, over the times in any view.
  const notices = (
    <>
      {picked && !pickedFree && (
        <Alert variant="warning">
          <AlertTitle>
            Время {formatTime(picked.startsAt, zone)} уже заняли
          </AlertTitle>
          <AlertDescription>Выберите другое.</AlertDescription>
        </Alert>
      )}

      {isStaff ? (
        <Alert variant="info">
          <AlertTitle>Предпросмотр</AlertTitle>
          <AlertDescription>Так страницу видят ваши клиенты.</AlertDescription>
        </Alert>
      ) : guestFlow || intro ? null : !signedIn ? (
        <Alert variant="info">
          <AlertTitle>Войдите, чтобы записаться</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>Свободное время видно и без входа.</span>
            <Button size="sm" nativeButton={false} render={cabinet}>
              {bookingUrl ? "Войти и записаться" : "Войти"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : !membership ? (
        <Alert variant="info">
          <AlertTitle>Станьте клиентом</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>
              {canPay
                ? `Оплатите ${terms.credits} онлайн — и сразу выбирайте время.`
                : "Затем администратор добавит оплату."}
            </span>
            <div className="flex flex-wrap gap-2">
              {canPay && (
                <Button size="sm" onClick={() => setTopUp(true)}>
                  <WalletIcon />
                  Оплатить {terms.credits}
                </Button>
              )}
              <Button
                size="sm"
                variant={canPay ? "outline" : "default"}
                disabled={join.isPending}
                onClick={() => join.mutate({ practiceId: practice.id })}
              >
                Стать клиентом
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : credits < price ? (
        <Alert variant="warning">
          <AlertTitle>
            {credits === 0
              ? `Нет оплаченных ${terms.credit[2]}`
              : `Не хватает ${terms.credit[2]}: нужно ${price}, на балансе ${credits}`}
          </AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            {canPay ? (
              <>
                <span>Пополните баланс, чтобы записаться.</span>
                <Button size="sm" onClick={() => setTopUp(true)}>
                  <WalletIcon />
                  Пополнить баланс
                </Button>
              </>
            ) : (
              "Обратитесь к администратору, чтобы оплатить."
            )}
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );

  return (
    <main
      ref={reportFrameHeight}
      {...bookingThemeAttributes(info.theme)}
      className={cn(
        displayFonts,
        "flex min-h-svh flex-col items-center bg-background px-4 py-8 md:py-14 [[data-framed]_&]:min-h-0",
      )}
    >
      <div className="flex w-full max-w-4xl flex-1 flex-col gap-8">
        {/* The specialist */}
        <header className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar className="size-16 shrink-0 sm:size-20">
              {practice.imageUrl && (
                <AvatarImage src={practice.imageUrl} alt={practice.name} />
              )}
              <AvatarFallback className="font-display text-xl sm:text-2xl">
                {initials(practice.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="font-display text-3xl leading-tight font-medium tracking-tight text-balance sm:text-4xl">
                {practice.name}
              </h1>
              {info.theme.about && (
                <p className="max-w-prose text-pretty whitespace-pre-line">
                  {info.theme.about}
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                Запись на {terms.creditAccusative}
                {services.length <= 1 && `, ${formatMinutes(serviceMinutes)}`}
                {info.freeBooking &&
                  ` · ${terms.free.toLowerCase()} бесплатно, ${introLength}`}
              </p>
            </div>
          </div>

          {membership ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:flex-col sm:items-end">
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href={paths.booking.mine} target="_top" />}
              >
                <CalendarCheckIcon />
                Мои записи
              </Button>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <WalletIcon className="size-4" />
                Оплачено
                <Badge
                  variant={credits > 0 ? "success-light" : "warning-light"}
                >
                  {formatCredits(credits, terms)}
                </Badge>
                {canPay && (
                  <Button
                    variant="link"
                    size="xs"
                    className="h-auto px-0"
                    onClick={() => setTopUp(true)}
                  >
                    Пополнить
                  </Button>
                )}
              </p>
            </div>
          ) : (
            !signedIn && (
              <Button
                variant="outline"
                size="sm"
                className="self-start sm:self-auto"
                nativeButton={false}
                render={cabinet}
              >
                <LogInIcon />
                Мой кабинет
              </Button>
            )
          )}
        </header>

        <div
          ref={panel}
          tabIndex={-1}
          className="scroll-mt-4 overflow-hidden rounded-2xl border bg-card shadow-xs outline-none"
        >
          {bookedIntro ? (
            <section className="flex flex-col items-center gap-6 px-6 py-14 text-center">
              <IconTile variant="soft" size="xl" className="text-success">
                <CircleCheckIcon />
              </IconTile>
              <div className="flex flex-col gap-2">
                <h2 className="font-display text-3xl font-medium tracking-tight">
                  Вы записаны
                </h2>
                <p className="first-letter:uppercase">
                  {formatDateTime(bookedIntro.startsAt, zone)},{" "}
                  {terms.free.toLowerCase()},{" "}
                  {/* Its own length: the setting may change meanwhile. */}
                  {formatMinutes(
                    (bookedIntro.endsAt.getTime() -
                      bookedIntro.startsAt.getTime()) /
                      60_000,
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  Бесплатно. Ссылку на запись мы отправили на почту — по ней её
                  можно отменить.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  nativeButton={false}
                  render={
                    <Link
                      href={paths.booking.guest(bookedIntro.token)}
                      target="_top"
                    />
                  }
                >
                  Открыть запись
                </Button>
                {signedIn && (
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={paths.booking.mine} target="_top" />}
                  >
                    Мои записи
                  </Button>
                )}
              </div>
            </section>
          ) : booked ? (
            <section className="flex flex-col items-center gap-6 px-6 py-14 text-center">
              <IconTile variant="soft" size="xl" className="text-success">
                <CircleCheckIcon />
              </IconTile>
              <div className="flex flex-col gap-2">
                <h2 className="font-display text-3xl font-medium tracking-tight">
                  Вы записаны
                </h2>
                <p className="first-letter:uppercase">
                  {bookedCount > 1
                    ? `${formatCredits(bookedCount, terms)}, начиная с ${formatDateTime(booked, zone)}`
                    : `${formatDateTime(booked, zone)}, ${formatMinutes(bookedMinutes)}`}
                </p>
                <p className="text-sm text-muted-foreground">
                  Осталось оплаченных: {formatCredits(credits, terms)}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={paths.booking.mine} target="_top" />}
                >
                  Мои записи
                </Button>
                <Button onClick={() => setBooked(null)}>Записаться ещё</Button>
              </div>
            </section>
          ) : checkout ? (
            <div
              key={picked.startsAt.toISOString()}
              className="grid animate-in duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] fade-in motion-reduce:animate-none md:grid-cols-[18rem_1fr]"
            >
              <BookingTicket
                startsAt={picked.startsAt}
                endsAt={picked.endsAt}
                timeZone={zone}
                what={intro ? terms.free : (service?.name ?? what)}
                onBack={() => choose(null)}
              />
              <section className="p-6 md:p-8 [&>*]:max-w-lg">
                {intro ? (
                  <IntroBookingForm
                    practiceId={practice.id}
                    intro={terms.free}
                    length={introLength}
                    startsAt={picked.startsAt}
                    timeZone={zone}
                    signedIn={signedIn}
                    needsPhone={needsPhone}
                    questions={questions}
                    onBooked={async (booking) => {
                      setBookedIntro(booking);
                      setPicked(null);
                      await refresh();
                    }}
                    onTaken={async () => {
                      await refresh();
                    }}
                  />
                ) : guestFlow && offer.data ? (
                  <GuestBookingForm
                    practice={practice}
                    startsAt={picked.startsAt}
                    timeZone={zone}
                    offer={offer.data}
                    service={service}
                    questions={questions}
                  />
                ) : (
                  <div className="flex flex-col gap-4">
                    <h2 className="text-base font-semibold">
                      Подтвердите запись
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      С баланса спишется {formatCredits(price, terms)},
                      останется {formatCredits(credits - price, terms)}.
                    </p>
                    {questions.length > 0 && (
                      <BookingQuestionFields
                        questions={questions}
                        values={answers}
                        errors={answerErrors}
                        onChange={setAnswers}
                        idPrefix="booking-question"
                      />
                    )}
                    {needsPhone && (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="booking-phone">Телефон</Label>
                        <Input
                          id="booking-phone"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          placeholder="+7 900 123-45-67"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                        />
                      </div>
                    )}
                    <Button
                      size="lg"
                      disabled={book.isPending || savePhone.isPending}
                      onClick={() => confirm(picked)}
                    >
                      {(book.isPending || savePhone.isPending) && <Spinner />}
                      Записаться
                    </Button>
                    {credits >= 2 * price && !needsPhone && (
                      <Button
                        variant="outline"
                        onClick={() =>
                          answered() && setSeriesFrom(picked.startsAt)
                        }
                      >
                        <RepeatIcon />
                        Повторять каждую неделю…
                      </Button>
                    )}
                  </div>
                )}
              </section>
            </div>
          ) : (
            <>
              {/* Kind of meeting and the layout; on a phone only the kind. */}
              <div
                className={cn(
                  "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-6 py-4",
                  !info.freeBooking && "max-md:hidden",
                )}
              >
                {info.freeBooking ? (
                  <>
                    <Tabs
                      className="max-sm:w-full"
                      value={kind}
                      onValueChange={(value) => {
                        setChosenKind(value as Kind);
                        setPicked(null);
                      }}
                    >
                      {/* On a phone the tabs share the row and long names
                          («Первичная консультация») wrap; the header above
                          already says how long and what it costs. */}
                      <TabsList className="max-sm:h-auto max-sm:w-full max-sm:items-stretch">
                        <TabsTrigger
                          value="consultation"
                          className="max-sm:h-auto max-sm:min-w-0 max-sm:whitespace-normal"
                        >
                          <CalendarCheckIcon />
                          {services.length === 1 && service
                            ? service.name
                            : what}
                          {services.length <= 1 && (
                            <span className="max-sm:hidden">
                              · {formatMinutes(serviceMinutes, true)}
                            </span>
                          )}
                        </TabsTrigger>
                        <TabsTrigger
                          value="free"
                          className="max-sm:h-auto max-sm:min-w-0 max-sm:whitespace-normal"
                        >
                          <GiftIcon />
                          {terms.free}
                          <span className="max-sm:hidden">· бесплатно</span>
                        </TabsTrigger>
                      </TabsList>
                    </Tabs>
                    {intro && (
                      // Under the tabs and the layout switch, a row of its own.
                      <p className="order-last w-full text-sm text-muted-foreground">
                        {capitalize(introLength)}, чтобы познакомиться. Один
                        раз, без оплаты.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Выберите удобное время
                  </p>
                )}
                <ToggleGroup
                  variant="outline"
                  size="sm"
                  value={[shown]}
                  onValueChange={(value) => {
                    const next = value[0];
                    if (isBookingView(next)) changeView(next);
                  }}
                  aria-label="Вид расписания"
                  className="hidden md:flex"
                >
                  <ToggleGroupItem value="month">
                    <CalendarDaysIcon />
                    Месяц
                  </ToggleGroupItem>
                  <ToggleGroupItem value="week">
                    <CalendarRangeIcon />
                    Неделя
                  </ToggleGroupItem>
                  <ToggleGroupItem value="columns">
                    <Columns3Icon />
                    Столбцы
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
              {!intro && services.length > 1 && service && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-6 py-3">
                  <Label htmlFor="booking-service" className="shrink-0">
                    Услуга
                  </Label>
                  <Select
                    items={Object.fromEntries(
                      services.map((item) => [item.id, item.name]),
                    )}
                    value={service.id}
                    onValueChange={(id) => {
                      setChosenServiceId(String(id));
                      setPicked(null);
                    }}
                  >
                    <SelectTrigger
                      id="booking-service"
                      className="w-full sm:w-72"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {services.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name} · {formatMinutes(item.minutes, true)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-muted-foreground">
                    {formatMinutes(service.minutes)} ·{" "}
                    {formatCredits(service.credits, terms)}
                  </span>
                </div>
              )}
              {shown !== "month" ? (
                <section className="flex min-h-80 flex-col gap-5 p-6">
                  <div className="flex items-center justify-between gap-4">
                    <h2 className="font-display text-2xl font-medium tracking-tight">
                      {formatWeekRange(week)}
                    </h2>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label="Предыдущая неделя"
                        disabled={week <= weekStart(viewerToday)}
                        onClick={() => moveWeek(-7)}
                      >
                        <ChevronLeftIcon />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label="Следующая неделя"
                        onClick={() => moveWeek(7)}
                      >
                        <ChevronRightIcon />
                      </Button>
                    </div>
                  </div>

                  {notices}

                  {slots.isError ? (
                    <ErrorState onRetry={() => slots.refetch()} />
                  ) : !slots.data || slots.isPlaceholderData ? (
                    // The last range's times are not this week's.
                    <WeekSkeleton />
                  ) : byDay.size === 0 ? (
                    <div className="flex flex-col items-start gap-3">
                      <p className="text-sm text-muted-foreground">
                        На этой неделе свободного времени нет.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => moveWeek(7)}
                      >
                        Следующая неделя
                      </Button>
                    </div>
                  ) : shown === "week" ? (
                    <WeekGrid
                      days={weekDays(week)}
                      byDay={byDay}
                      today={viewerToday}
                      timeZone={zone}
                      disabled={slotsDisabled}
                      onPick={choose}
                    />
                  ) : (
                    <WeekColumns
                      days={weekDays(week)}
                      byDay={byDay}
                      today={viewerToday}
                      timeZone={zone}
                      disabled={slotsDisabled}
                      onPick={choose}
                    />
                  )}
                </section>
              ) : (
                <div className="grid md:grid-cols-[auto_1fr]">
                  {/* Month */}
                  <section className="border-b p-6 md:border-r md:border-b-0">
                    {slots.isError ? (
                      <ErrorState onRetry={() => slots.refetch()} />
                    ) : (
                      <Calendar
                        mode="single"
                        locale={ru}
                        weekStartsOn={1}
                        month={month}
                        onMonthChange={(next) => {
                          setMonth(next);
                          setPicked(null);
                        }}
                        startMonth={keyToDate(today)}
                        selected={
                          selectedDay ? keyToDate(selectedDay) : undefined
                        }
                        onSelect={(date) => {
                          if (date) setDay(dateKey(date));
                          setPicked(null);
                        }}
                        disabled={(date) => !byDay.has(dateKey(date))}
                        formatters={{
                          formatCaption: (date) =>
                            capitalize(
                              format(date, "LLLL yyyy", { locale: ru }),
                            ),
                        }}
                        modifiers={{
                          available: (date) => byDay.has(dateKey(date)),
                        }}
                        modifiersClassNames={{
                          // A dot under each day with free time.
                          available:
                            "[&>button]:font-semibold after:pointer-events-none after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary data-[selected=true]:after:bg-primary-foreground",
                        }}
                        className="mx-auto w-full bg-transparent p-0 [--cell-size:--spacing(10)] sm:[--cell-size:--spacing(11)]"
                      />
                    )}
                  </section>

                  {/* Times */}
                  <section className="flex min-h-80 flex-col gap-5 p-6">
                    <h2 className="font-display text-2xl font-medium tracking-tight first-letter:uppercase">
                      {selectedDay
                        ? keyToDate(selectedDay).toLocaleDateString("ru-RU", {
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                          })
                        : "Свободное время"}
                    </h2>

                    {notices}

                    {slots.isPending && !slots.data ? (
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
                        {["a", "b", "c", "d", "e", "f"].map((k) => (
                          <Skeleton key={k} className="h-10" />
                        ))}
                      </div>
                    ) : daySlots.length === 0 ? (
                      <div className="flex flex-col items-start gap-3">
                        <p className="text-sm text-muted-foreground">
                          В этом месяце свободного времени нет.
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setMonth(
                              new Date(
                                month.getFullYear(),
                                month.getMonth() + 1,
                              ),
                            );
                            setPicked(null);
                          }}
                        >
                          Следующий месяц
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-5">
                        {byDayPart(daySlots, zone).map((part) => (
                          <div key={part.label} className="flex flex-col gap-2">
                            <h3 className="text-sm text-muted-foreground">
                              {part.label}
                            </h3>
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
                              {part.slots.map((slot) => (
                                <Button
                                  key={slot.startsAt.toISOString()}
                                  variant="outline"
                                  size="lg"
                                  disabled={slotsDisabled}
                                  onClick={() => choose(slot)}
                                  className="text-base tabular-nums"
                                >
                                  {formatTime(slot.startsAt, zone)}
                                </Button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              )}
            </>
          )}

          {!isStaff && !intro && !booked && !bookedIntro && !picked && (
            <WaitlistRow
              practiceId={practice.id}
              timezone={practice.timezone}
              services={services}
              serviceId={service?.id}
              signedIn={signedIn}
              viewerZone={zone}
            />
          )}

          <footer className="flex flex-col gap-2 border-t bg-muted/40 px-6 py-4 text-xs text-muted-foreground sm:flex-row sm:gap-6 dark:bg-muted/20">
            <p className="flex items-start gap-2">
              <UndoDotIcon className="mt-px size-3.5 shrink-0" />
              {intro
                ? "Бесплатную запись можно отменить до её начала по ссылке из письма."
                : `Отменить запись и вернуть ${terms.creditAccusative} на баланс можно не позднее чем за 24 часа до начала.`}
            </p>
            <div className="flex flex-col gap-1.5 sm:ml-auto sm:items-end">
              <div className="flex items-center gap-2">
                <span>Время в поясе</span>
                {/* The zone is the browser's: the server doesn't know it. */}
                {hydrated ? (
                  <TimeZoneSelect
                    value={zone}
                    onChange={changeZone}
                    extra={[practice.timezone, browserZone]}
                  />
                ) : (
                  <Skeleton className="h-8 w-40" />
                )}
              </div>
              {hydrated && zone !== practice.timezone && (
                <p suppressHydrationWarning>
                  У специалиста сейчас{" "}
                  {formatTime(new Date(), practice.timezone)} (
                  {viewerTimeZoneName(practice.timezone)})
                </p>
              )}
            </div>
          </footer>
        </div>
      </div>

      <LegalFooter className="pt-10" />
      {info.showBadge && <SynoroBadge className="pt-2" />}
      <SeriesDialog
        practiceId={practice.id}
        startsAt={seriesFrom}
        timeZone={zone}
        credits={credits}
        serviceId={service?.id}
        price={price}
        terms={terms}
        answers={answers}
        onAnswersInvalid={async (errors) => {
          // Back to the questionnaire, with the questions asked now.
          setSeriesFrom(null);
          setAnswerErrors(errors);
          await refresh();
        }}
        onClose={() => setSeriesFrom(null)}
        onBooked={async (dates) => {
          setSeriesFrom(null);
          setPicked(null);
          setAnswers({});
          setBooked(dates[0] ?? null);
          setBookedCount(dates.length);
          setBookedMinutes(serviceMinutes);
          await refresh();
        }}
      />
      {canPay && (
        <TopUpDialog
          practice={{
            id: practice.id,
            name: practice.name,
            profession: practice.profession,
          }}
          balance={credits}
          open={topUp}
          onOpenChange={setTopUp}
        />
      )}
    </main>
  );
}
