import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@synoro/ui";
import { Suspense } from "react";

import { requireAdmin } from "~/auth/server";
import { PageHeader } from "~/components/page-header";
import { formatCount, formatKopecks } from "~/lib/format";
import { api } from "~/orpc/server";

export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Обзор" />
      <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4">
        <Suspense
          fallback={["a", "b", "c", "d", "e", "f", "g", "h"].map((key) => (
            <Skeleton key={key} className="h-28" />
          ))}
        >
          <Stats />
        </Suspense>
      </div>
    </>
  );
}

async function Stats() {
  await requireAdmin();
  const stats = await api.stats.overview();

  const tiles = [
    {
      label: "Пользователи",
      value: formatCount(stats.users.total),
      note: `+${formatCount(stats.users.week)} за 7 дней, +${formatCount(stats.users.month)} за 30`,
    },
    {
      label: "Практики",
      value: formatCount(stats.practices.total),
      note: `+${formatCount(stats.practices.month)} за 30 дней`,
    },
    {
      label: "Платят за «Про»",
      value: formatCount(stats.pro.paying),
      note: "оплаченный период идёт сейчас",
    },
    {
      label: "На пробном периоде",
      value: formatCount(stats.pro.trial),
      note: "14 дней с первой практики",
    },
    {
      label: "Выручка «Про» за 30 дней",
      value: formatKopecks(stats.revenue.month),
      note: "без возвратов",
    },
    {
      label: "Выручка «Про» всего",
      value: formatKopecks(stats.revenue.total),
      note: `${formatCount(stats.revenue.payments)} платежей`,
    },
    {
      label: "Записи за 30 дней",
      value: formatCount(stats.bookings.month),
      note: "созданы во всех практиках",
    },
  ];

  return tiles.map((tile) => (
    <Card key={tile.label}>
      <CardHeader>
        <CardDescription>{tile.label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{tile.value}</CardTitle>
        <CardDescription className="text-xs">{tile.note}</CardDescription>
      </CardHeader>
    </Card>
  ));
}
