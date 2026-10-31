"use client";

import type { RouterOutputs } from "@synoro/api";
import {
  Button,
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  Skeleton,
} from "@synoro/ui";
import { Alert, AlertDescription, AlertTitle } from "@synoro/ui/reui/alert";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@synoro/ui/reui/frame";
import { ANALYTICS_PERIODS, type AnalyticsPeriod } from "@synoro/validators";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChartNoAxesColumnIcon } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ProRequired } from "~/components/billing/pro-required";
import { ErrorState } from "~/components/booking/states";
import { formatRub } from "~/components/payment/format";
import { orpc } from "~/orpc/react";

type Report = NonNullable<RouterOutputs["analytics"]["overview"]["report"]>;
type Stats = Report["stats"];

const PERIOD_LABEL: Record<AnalyticsPeriod, string> = {
  30: "30 дней",
  90: "90 дней",
  365: "Год",
};

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const percent = (share: number | null) =>
  share === null ? "—" : `${Math.round(share * 100)}%`;

/** «3 нояб.» from a local date like `2026-11-03`. */
function shortDate(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T00:00:00Z`));
}

function Tile({
  label,
  value,
  before,
  hint,
}: {
  label: string;
  value: string;
  /** The same number for the stretch before, shown as a comparison. */
  before?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-md border p-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">
        {before === undefined ? hint : `Раньше: ${before}`}
      </span>
    </div>
  );
}

function Tiles({ stats, previous }: { stats: Stats; previous: Stats }) {
  const held = (s: Stats) => s.meetings + s.intros;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <Tile
        label="Встречи"
        value={String(held(stats))}
        before={String(held(previous))}
      />
      <Tile
        label="Часов работы"
        value={String(stats.hours)}
        before={String(previous.hours)}
      />
      <Tile
        label="Онлайн-оплаты"
        value={formatRub(stats.revenue)}
        before={formatRub(previous.revenue)}
      />
      <Tile
        label="Неявки"
        value={percent(stats.noShowRate)}
        before={percent(previous.noShowRate)}
      />
      <Tile
        label="Клиентов приходило"
        value={String(stats.activeClients)}
        before={String(previous.activeClients)}
      />
      <Tile
        label="Из них новых"
        value={String(stats.newClients)}
        before={String(previous.newClients)}
      />
    </div>
  );
}

const meetingsConfig = {
  meetings: { label: "Встречи", color: "var(--chart-2)" },
} satisfies ChartConfig;

const revenueConfig = {
  revenue: { label: "Оплаты, ₽", color: "var(--chart-1)" },
} satisfies ChartConfig;

function Series({
  series,
  field,
  config,
  unit,
}: {
  series: Report["series"]["points"];
  field: "meetings" | "revenue";
  config: ChartConfig;
  unit: Report["series"]["unit"];
}) {
  // Money is stored in kopecks; the axis and the tooltip speak rubles.
  const data = series.map((point) => ({
    date: point.date,
    meetings: point.meetings,
    revenue: point.revenue / 100,
  }));
  return (
    <ChartContainer config={config} className="aspect-auto h-56 w-full">
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          tickFormatter={shortDate}
        />
        <YAxis
          width={44}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, items) => {
                const date = items[0]?.payload?.date as string | undefined;
                if (!date) return "";
                return unit === "week"
                  ? `Неделя с ${shortDate(date)}`
                  : shortDate(date);
              }}
            />
          }
        />
        <Bar dataKey={field} fill={`var(--color-${field})`} radius={3} />
      </BarChart>
    </ChartContainer>
  );
}

/** Weekday × hour grid: darker is busier. */
function BusyHours({ load }: { load: Report["load"] }) {
  const max = Math.max(1, ...load.map((cell) => cell.count));
  const hours = load.map((cell) => cell.hour);
  const from = Math.min(8, ...hours);
  const to = Math.max(21, ...hours);
  const range = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const counts = new Map(
    load.map((cell) => [`${cell.weekday}:${cell.hour}`, cell.count]),
  );

  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-[32rem] gap-1 text-xs text-muted-foreground"
        style={{
          gridTemplateColumns: `2rem repeat(${range.length}, minmax(0, 1fr))`,
        }}
      >
        <span />
        {range.map((hour) => (
          <span key={hour} className="text-center tabular-nums">
            {hour}
          </span>
        ))}
        {WEEKDAYS.map((day, index) => (
          <WeekRow
            key={day}
            day={day}
            weekday={index + 1}
            range={range}
            counts={counts}
            max={max}
          />
        ))}
      </div>
    </div>
  );
}

function WeekRow({
  day,
  weekday,
  range,
  counts,
  max,
}: {
  day: string;
  weekday: number;
  range: number[];
  counts: Map<string, number>;
  max: number;
}) {
  return (
    <>
      <span className="self-center">{day}</span>
      {range.map((hour) => {
        const count = counts.get(`${weekday}:${hour}`) ?? 0;
        return (
          <span
            key={hour}
            role="img"
            aria-label={`${day}, ${hour}:00 — встреч: ${count}`}
            title={`${day}, ${hour}:00 — встреч: ${count}`}
            className="h-6 rounded-sm bg-muted"
            style={
              count > 0
                ? {
                    backgroundColor: "var(--chart-2)",
                    opacity: 0.25 + 0.75 * (count / max),
                  }
                : undefined
            }
          />
        );
      })}
    </>
  );
}

function Cancellations({ stats }: { stats: Stats }) {
  const rows = [
    { label: "Отменил клиент", value: stats.cancelledByClient },
    { label: "Отменили вы или администратор", value: stats.cancelledByStaff },
    { label: "Не пришёл", value: stats.noShows },
  ];
  return (
    <ul className="flex flex-col divide-y rounded-md border">
      {rows.map((row) => (
        <li
          key={row.label}
          className="flex items-center justify-between gap-3 p-3 text-sm"
        >
          <span>{row.label}</span>
          <span className="font-medium tabular-nums">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}

export function PracticeAnalytics({
  practiceId,
  isOwner,
}: {
  practiceId: string;
  isOwner: boolean;
}) {
  const [days, setDays] = useState<AnalyticsPeriod>(30);
  const overview = useQuery({
    ...orpc.analytics.overview.queryOptions({ input: { practiceId, days } }),
    enabled: isOwner,
    placeholderData: keepPreviousData,
  });

  if (!isOwner) {
    return (
      <div className="flex max-w-4xl flex-col gap-6">
        <Alert variant="info">
          <ChartNoAxesColumnIcon />
          <AlertTitle>Аналитику видит владелец практики</AlertTitle>
          <AlertDescription>
            В ней оплаты и клиенты всей практики, поэтому администраторам она не
            показывается.
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  if (overview.isPending) {
    return <Skeleton className="h-96 max-w-4xl rounded-xl" />;
  }
  if (overview.isError) {
    return (
      <ErrorState
        message="Не удалось загрузить аналитику."
        onRetry={() => overview.refetch()}
      />
    );
  }

  const { report } = overview.data;
  if (!report) {
    return (
      <div className="flex max-w-4xl flex-col gap-6">
        <ProRequired feature="Аналитика практики" />
      </div>
    );
  }

  const { stats, previous, series, load } = report;
  // Each section shows when it has data of its own: a client can pay for
  // future meetings or cancel in a period with no meetings held.
  const hasMeetings = stats.meetings + stats.intros + stats.noShows > 0;
  const hasCancellations =
    stats.cancelledByClient + stats.cancelledByStaff + stats.noShows > 0;
  const quiet = !hasMeetings && !hasCancellations && stats.revenue === 0;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {ANALYTICS_PERIODS.map((period) => (
          <Button
            key={period}
            size="sm"
            variant={period === days ? "secondary" : "outline"}
            aria-pressed={period === days}
            onClick={() => setDays(period)}
          >
            {PERIOD_LABEL[period]}
          </Button>
        ))}
        <span className="text-sm text-muted-foreground">
          Сравнение — с такими же днями раньше
        </span>
      </div>

      <Frame spacing="default" className="min-w-0">
        <FramePanel className="flex flex-col gap-4">
          <FrameHeader className="p-0">
            <FrameTitle>Итоги</FrameTitle>
            <FrameDescription>
              Считаются встречи, которые уже прошли. Оплаты — только онлайн, те,
              что прошли через вашу кассу; пакеты, которые вы внесли вручную,
              сюда не входят.
            </FrameDescription>
          </FrameHeader>
          <Tiles stats={stats} previous={previous} />
        </FramePanel>
      </Frame>

      {quiet ? (
        <p className="text-sm text-muted-foreground">
          За этот период не было ни встреч, ни оплат, ни отмен — графики
          появятся, когда они будут.
        </p>
      ) : (
        <>
          {hasMeetings && (
            <Frame spacing="default" className="min-w-0">
              <FramePanel className="flex flex-col gap-4">
                <FrameHeader className="p-0">
                  <FrameTitle>Встречи</FrameTitle>
                  <FrameDescription>
                    {series.unit === "week" ? "По неделям." : "По дням."}
                  </FrameDescription>
                </FrameHeader>
                <Series
                  series={series.points}
                  field="meetings"
                  config={meetingsConfig}
                  unit={series.unit}
                />
              </FramePanel>
            </Frame>
          )}

          {stats.revenue > 0 && (
            <Frame spacing="default" className="min-w-0">
              <FramePanel className="flex flex-col gap-4">
                <FrameHeader className="p-0">
                  <FrameTitle>Онлайн-оплаты</FrameTitle>
                  <FrameDescription>
                    {series.unit === "week" ? "По неделям." : "По дням."} Всего
                    оплат: {stats.payments}.
                  </FrameDescription>
                </FrameHeader>
                <Series
                  series={series.points}
                  field="revenue"
                  config={revenueConfig}
                  unit={series.unit}
                />
              </FramePanel>
            </Frame>
          )}

          {hasMeetings && (
            <Frame spacing="default" className="min-w-0">
              <FramePanel className="flex flex-col gap-4">
                <FrameHeader className="p-0">
                  <FrameTitle>Когда вы работаете</FrameTitle>
                  <FrameDescription>
                    Начало встреч по дням недели и часам, время практики (
                    {report.timeZone}). Темнее — больше встреч.
                  </FrameDescription>
                </FrameHeader>
                <BusyHours load={load} />
              </FramePanel>
            </Frame>
          )}

          {hasCancellations && (
            <Frame spacing="default" className="min-w-0">
              <FramePanel className="flex flex-col gap-4">
                <FrameHeader className="p-0">
                  <FrameTitle>Отмены и неявки</FrameTitle>
                  <FrameDescription>
                    Неявка — когда клиент не пришёл и занятие не вернулось на
                    баланс.
                  </FrameDescription>
                </FrameHeader>
                <Cancellations stats={stats} />
              </FramePanel>
            </Frame>
          )}
        </>
      )}
    </div>
  );
}
