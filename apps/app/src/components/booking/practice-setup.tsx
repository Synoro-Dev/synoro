"use client";

import { legal, paths, YOUR_DATA_PATH } from "@synoro/config";
import {
  Button,
  cn,
  FieldError,
  Label,
  Progress,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from "@synoro/ui";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import { availabilityFormSchema, capitalize } from "@synoro/validators";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArchiveIcon,
  ArrowLeftRightIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  CheckIcon,
  FileSpreadsheetIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";

import { orpc } from "~/orpc/react";
import { PackagesEditor } from "../payment/packages-editor";
import { BookingLinkActions } from "./booking-link";
import { PracticeFreeBooking } from "./practice-free-booking";
import { PracticeRules } from "./practice-rules";
import {
  SETUP_STEPS,
  type SetupStep,
  setupStepFrom,
  setupStepHref,
} from "./practice-setup-steps";
import { PracticeTimeZone } from "./practice-timezone";
import { dayIntervals, gridFromRules } from "./slot-grid";
import { ErrorState } from "./states";
import { useTerms } from "./terms";
import { minutesToTime, viewerTimeZoneName, WEEKDAY_NAMES } from "./time";
import { TimeSelect } from "./time-select";

const STEP_META: Record<
  SetupStep,
  { short: string; title: string; description: string }
> = {
  import: {
    short: "Клиенты",
    title: "Перенести клиентов",
    description: "Если вы уже ведёте клиентов в таблице или другом сервисе",
  },
  hours: {
    short: "Часы",
    title: "Рабочие часы",
    description: "Когда клиенты смогут к вам записаться",
  },
  prices: {
    short: "Цены",
    title: "Цены и бесплатная запись",
    description: "Что клиент сможет оплатить и нужна ли бесплатная запись",
  },
  rules: {
    short: "Правила",
    title: "Правила",
    description: "Что клиент может сделать с записью сам",
  },
  link: {
    short: "Ссылка",
    title: "Ссылка на страницу записи",
    description: "Отправьте её клиентам: дальше они записываются сами",
  },
};

const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const DEFAULT_DAYS = [1, 2, 3, 4, 5];
/** 09:00–18:00, the editor's usual working day. */
const DEFAULT_HOURS = { start: 540, end: 1080 };

interface SetupPractice {
  id: string;
  bookingUrl: string;
  timezone: string;
  freeBookingEnabled: boolean;
  introMinutes: number;
  cancelHours: number;
  lateCancel: boolean;
}

interface StepNav {
  back?: () => void;
  skip: () => void;
  next: () => void;
}

/** Back on the left, skip and go on on the right; wraps on a phone. */
function StepActions({ nav, primary }: { nav: StepNav; primary: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {nav.back && (
        <Button type="button" variant="ghost" onClick={nav.back}>
          Назад
        </Button>
      )}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={nav.skip}>
          Пропустить
        </Button>
        {primary}
      </div>
    </div>
  );
}

const IMPORT_SOURCES = [
  { icon: FileSpreadsheetIcon, title: "Excel или Google Таблицы" },
  { icon: CalendarDaysIcon, title: "Google или Яндекс Календарь" },
  { icon: ArrowLeftRightIcon, title: "YCLIENTS, DIKIDI и другие сервисы" },
  { icon: ArchiveIcon, title: "Архив, скачанный из Synoro" },
];

/**
 * Where the clients are now. The first step on purpose: moving is what people
 * are afraid of. Nobody is told anything, so there's no risk in trying.
 */
function ImportStep({ practiceId, nav }: { practiceId: string; nav: StepNav }) {
  return (
    <div className="flex flex-col gap-6">
      <Frame spacing="default">
        <FramePanel className="flex flex-col gap-4">
          <ul className="grid gap-3 sm:grid-cols-2">
            {IMPORT_SOURCES.map((source) => (
              <li key={source.title} className="flex items-center gap-3">
                <source.icon
                  className="size-5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="text-sm">{source.title}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">
            Клиенты ничего не получат: ни писем, ни сообщений. Любую загрузку
            можно отменить одной кнопкой, а забрать все данные обратно можно в
            любой момент.{" "}
            <a
              href={`${legal.siteUrl}${YOUR_DATA_PATH}`}
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline underline-offset-4"
            >
              Ваши данные — ваши
            </a>
          </p>
          <div>
            <Button
              nativeButton={false}
              render={<Link href={paths.booking.import(practiceId)} />}
            >
              Перенести клиентов
            </Button>
          </div>
        </FramePanel>
      </Frame>
      <StepActions nav={nav} primary={<NextButton onClick={nav.next} />} />
    </div>
  );
}

function NextButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" onClick={onClick}>
      Дальше
      <ArrowRightIcon />
    </Button>
  );
}

/**
 * The working week the short way: which days, from when to when. The rest —
 * breaks, different hours per day — is in the full editor, which also takes
 * over once the practice has hours, so nothing set there is overwritten.
 */
function HoursStep({
  practice,
  nav,
}: {
  practice: SetupPractice;
  nav: StepNav;
}) {
  const rules = useQuery(
    orpc.availability.list.queryOptions({ input: { practiceId: practice.id } }),
  );
  if (rules.isError) return <ErrorState onRetry={() => rules.refetch()} />;
  if (rules.isPending) return <Skeleton className="h-72 w-full rounded-xl" />;
  return rules.data.length > 0 ? (
    <HoursSummary practice={practice} rules={rules.data} nav={nav} />
  ) : (
    <HoursForm practice={practice} nav={nav} />
  );
}

function HoursSummary({
  practice,
  rules,
  nav,
}: {
  practice: SetupPractice;
  rules: { weekday: number; startMinute: number; endMinute: number }[];
  nav: StepNav;
}) {
  const grid = gridFromRules(rules);
  return (
    <div className="flex flex-col gap-6">
      <Frame spacing="default" className="min-w-0">
        <FramePanel className="flex flex-col gap-4">
          <FrameHeader className="p-0">
            <FrameTitle>Рабочие часы уже заданы</FrameTitle>
            <FrameDescription>
              По времени: {viewerTimeZoneName(practice.timezone)}
            </FrameDescription>
          </FrameHeader>
          <ul className="flex flex-col gap-1 text-sm">
            {WEEKDAY_NAMES.map((name, day) => {
              const intervals = dayIntervals(grid, day);
              return (
                <li key={name} className="flex justify-between gap-4">
                  <span>{name}</span>
                  <span className="text-right text-muted-foreground tabular-nums">
                    {intervals.length > 0
                      ? intervals
                          .map(
                            ([from, to]) =>
                              `${minutesToTime(from)}–${minutesToTime(to)}`,
                          )
                          .join(", ")
                      : "выходной"}
                  </span>
                </li>
              );
            })}
          </ul>
          <Button
            variant="outline"
            className="self-start"
            nativeButton={false}
            render={<Link href={paths.booking.schedule(practice.id)} />}
          >
            Изменить часы
          </Button>
        </FramePanel>
      </Frame>
      <StepActions nav={nav} primary={<NextButton onClick={nav.next} />} />
    </div>
  );
}

function HoursForm({
  practice,
  nav,
}: {
  practice: SetupPractice;
  nav: StepNav;
}) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [start, setStart] = useState(DEFAULT_HOURS.start);
  const [end, setEnd] = useState(DEFAULT_HOURS.end);
  const [error, setError] = useState<string>();
  const save = useMutation({
    ...orpc.availability.replace.mutationOptions(),
    onSuccess: async () => {
      toast.success("Рабочие часы сохранены");
      // Before going on: back on this step the saved hours are shown.
      await queryClient.invalidateQueries({
        queryKey: orpc.availability.key(),
      });
      nav.next();
    },
    onError: (e) => toast.error(e.message),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (days.length === 0) {
      setError("Выберите хотя бы один день");
      return;
    }
    const parsed = availabilityFormSchema.safeParse({
      rules: days.map((weekday) => ({
        weekday,
        startMinute: start,
        endMinute: end,
      })),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Проверьте время");
      return;
    }
    setError(undefined);
    save.mutate({ practiceId: practice.id, rules: parsed.data.rules });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Frame spacing="default" className="min-w-0">
        <FramePanel className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label id="setup-days">Дни</Label>
            <ToggleGroup
              aria-labelledby="setup-days"
              multiple
              variant="outline"
              spacing={1}
              className="grid w-full grid-cols-7"
              value={days.map(String)}
              onValueChange={(value) => {
                setDays(value.map(Number).sort((a, b) => a - b));
                setError(undefined);
              }}
            >
              {WEEKDAY_SHORT.map((short, index) => (
                <ToggleGroupItem
                  key={short}
                  value={String(index + 1)}
                  aria-label={WEEKDAY_NAMES[index]}
                  className="px-0 data-pressed:border-brand data-pressed:bg-brand/10"
                >
                  {short}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-2">
              <Label>С</Label>
              <TimeSelect
                label="Начало дня"
                value={start}
                onChange={setStart}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>До</Label>
              <TimeSelect
                label="Конец дня"
                value={end}
                onChange={setEnd}
                endOfDay
              />
            </div>
          </div>
          {error ? <FieldError>{error}</FieldError> : null}
          <div className="flex flex-col gap-2">
            <Label>Часовой пояс</Label>
            <PracticeTimeZone
              practiceId={practice.id}
              timezone={practice.timezone}
            />
            <p className="text-sm text-muted-foreground">
              Клиенты увидят время в своём часовом поясе. Перерывы и разные часы
              по дням можно задать потом в настройках.
            </p>
          </div>
        </FramePanel>
      </Frame>
      <StepActions
        nav={nav}
        primary={
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Сохранение…" : "Сохранить и продолжить"}
          </Button>
        }
      />
    </form>
  );
}

const PRICES_FORM = "setup-prices";

function PricesStep({
  practice,
  nav,
}: {
  practice: SetupPractice;
  nav: StepNav;
}) {
  const terms = useTerms();
  const [dirty, setDirty] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <Frame spacing="default" className="min-w-0">
        <FramePanel className="flex flex-col gap-4">
          <FrameHeader className="p-0">
            <FrameTitle>Цены</FrameTitle>
            <FrameDescription>
              {capitalize(terms.credits)} по одной цене или пакетом со скидкой.
              Клиенты смогут оплатить их сами, когда вы подключите
              онлайн-оплату. А пока оплату начисляете вы, в карточке клиента.
            </FrameDescription>
          </FrameHeader>
          <PackagesEditor
            practiceId={practice.id}
            formId={PRICES_FORM}
            onDirtyChange={setDirty}
            onSaved={nav.next}
          />
        </FramePanel>
      </Frame>
      <Frame spacing="default" className="min-w-0">
        <PracticeFreeBooking
          practiceId={practice.id}
          enabled={practice.freeBookingEnabled}
          introMinutes={practice.introMinutes}
        />
      </Frame>
      <StepActions
        nav={nav}
        primary={
          dirty ? (
            <Button type="submit" form={PRICES_FORM}>
              Сохранить и продолжить
            </Button>
          ) : (
            <NextButton onClick={nav.next} />
          )
        }
      />
    </div>
  );
}

function LinkStep({
  practice,
  back,
}: {
  practice: SetupPractice;
  back: () => void;
}) {
  const router = useRouter();
  const later = [
    { title: "Добавить фото", href: paths.booking.page(practice.id) },
    {
      title: "Подключить онлайн-оплату",
      href: paths.booking.onlinePayment(practice.id),
    },
    { title: "Все настройки", href: paths.booking.settings(practice.id) },
  ];
  return (
    <div className="flex flex-col gap-6">
      <Frame spacing="default" className="min-w-0">
        <FramePanel className="flex flex-col gap-3">
          <FrameHeader className="p-0">
            <FrameTitle>Страница записи готова</FrameTitle>
            <FrameDescription>
              Клиенты записываются по ссылке без регистрации
            </FrameDescription>
          </FrameHeader>
          <BookingLinkActions url={practice.bookingUrl} />
        </FramePanel>
      </Frame>
      <nav aria-label="Что ещё настроить" className="flex flex-wrap gap-2">
        {later.map((item) => (
          <Button
            key={item.href}
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={item.href as Route} />}
          >
            {item.title}
          </Button>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" onClick={back}>
          Назад
        </Button>
        <Button
          type="button"
          className="ml-auto"
          onClick={() => router.push(paths.booking.practice(practice.id))}
        >
          <CheckIcon />
          Готово
        </Button>
      </div>
    </div>
  );
}

/**
 * The first setup: moving clients → hours → prices and free booking → rules →
 * link. Every step
 * can be skipped and nothing here is required, so it keeps no state of its
 * own: it opens once after creating the practice (`CreatePracticeDialog`) and
 * «Сегодня» shows what is left (`SetupProgress`), leading back to a step.
 */
export function PracticeSetup({
  practice: initial,
}: {
  practice: SetupPractice;
}) {
  const step = setupStepFrom(useSearchParams().get("step"));
  const index = SETUP_STEPS.indexOf(step);
  // Steps change without a round trip to the server, so what a step saved
  // comes back through this query, which saving invalidates.
  const { data: practice = initial } = useQuery(
    orpc.practice.get.queryOptions({ input: { practiceId: initial.id } }),
  );

  // The address carries the step: going back and forth needs no server.
  function go(next: SetupStep) {
    window.history.pushState(null, "", setupStepHref(practice.id, next));
    window.scrollTo({ top: 0 });
  }
  const forward = () => {
    const next = SETUP_STEPS[index + 1];
    if (next) go(next);
  };
  const before = SETUP_STEPS[index - 1];
  const nav: StepNav = {
    back: before ? () => go(before) : undefined,
    skip: forward,
    next: forward,
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-sm text-muted-foreground">
            Шаг {index + 1} из {SETUP_STEPS.length}
          </span>
          <Link
            href={paths.booking.practice(practice.id)}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Закончить позже
          </Link>
        </div>
        <Progress
          value={((index + 1) / SETUP_STEPS.length) * 100}
          aria-label={`Шаг ${index + 1} из ${SETUP_STEPS.length}`}
          className="[&_[data-slot=progress-indicator]]:bg-brand"
        />
        <ol className="hidden grid-cols-5 gap-2 sm:grid">
          {SETUP_STEPS.map((id, i) => (
            <li key={id}>
              <button
                type="button"
                aria-current={id === step ? "step" : undefined}
                onClick={() => go(id)}
                className={cn(
                  "w-full rounded-md py-1 text-left text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  id === step && "font-medium text-foreground",
                )}
              >
                {i + 1}. {STEP_META[id].short}
              </button>
            </li>
          ))}
        </ol>
        <div className="flex flex-col gap-0.5">
          <h1 className="text-xl font-semibold tracking-tight">
            {STEP_META[step].title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {STEP_META[step].description}
          </p>
        </div>
      </div>

      {step === "import" && <ImportStep practiceId={practice.id} nav={nav} />}
      {step === "hours" && <HoursStep practice={practice} nav={nav} />}
      {step === "prices" && <PricesStep practice={practice} nav={nav} />}
      {step === "rules" && (
        <div className="flex flex-col gap-6">
          <PracticeRules
            practiceId={practice.id}
            rules={{
              cancelHours: practice.cancelHours,
              lateCancel: practice.lateCancel,
            }}
            isOwner
          />
          <StepActions nav={nav} primary={<NextButton onClick={nav.next} />} />
        </div>
      )}
      {step === "link" && (
        <LinkStep practice={practice} back={() => go("rules")} />
      )}
    </div>
  );
}
