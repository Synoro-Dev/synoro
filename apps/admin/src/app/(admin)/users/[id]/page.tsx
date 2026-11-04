import { ORPCError } from "@orpc/server";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@synoro/ui";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";

import { requireAdmin } from "~/auth/server";
import { PageHeader } from "~/components/page-header";
import { PaymentStatus, PERIOD_LABELS } from "~/components/payment-status";
import { PlanBadge } from "~/components/plan-badge";
import { SignInTable } from "~/components/sign-in-table";
import { formatDate, formatDateTime, formatKopecks } from "~/lib/format";
import { bookingPageUrl } from "~/lib/links";
import { api } from "~/orpc/server";

const ROLE_LABELS = {
  owner: "Владелец",
  admin: "Администратор",
  client: "Клиент",
} as const;

export default function UserPage(props: { params: Promise<{ id: string }> }) {
  return (
    <>
      <PageHeader title="Пользователь" />
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <Suspense
          fallback={["a", "b"].map((key) => (
            <Skeleton key={key} className="h-64" />
          ))}
        >
          <UserCard params={props.params} />
        </Suspense>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

async function UserCard({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const [card, signIns] = await Promise.all([
    api.users.byId({ id }).catch((error: unknown) => {
      if (error instanceof ORPCError && error.code === "NOT_FOUND") notFound();
      throw error;
    }),
    api.signIns.list({ userId: id, limit: 20, offset: 0 }),
  ]);
  const { user, plan } = card;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {user.name}
            {user.role?.includes("admin") && (
              <Badge variant="secondary">админ</Badge>
            )}
            {user.banned && <Badge variant="destructive">бан</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label="Почта">
              {user.email}
              {!user.emailVerified && (
                <span className="text-muted-foreground">
                  {" "}
                  (не подтверждена)
                </span>
              )}
            </Row>
            <Row label="Телефон">{user.phone ?? "—"}</Row>
            <Row label="Регистрация">{formatDateTime(user.createdAt)}</Row>
            {user.banned && (
              <Row label="Бан">
                {user.banReason ?? "без причины"}
                {user.banExpires && `, до ${formatDate(user.banExpires)}`}
              </Row>
            )}
            <Row label="ID">
              <code className="text-xs">{user.id}</code>
            </Row>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Тариф</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label="Сейчас">
              <PlanBadge plan={plan.status} />
            </Row>
            <Row label="Пробный до">{formatDate(plan.trialEndsAt)}</Row>
            <Row label="Оплачен до">{formatDate(plan.paidUntil)}</Row>
            <Row label="Автопродление">
              {plan.autorenew
                ? `включено, ${PERIOD_LABELS[plan.autorenew].toLowerCase()}`
                : "выключено"}
            </Row>
          </dl>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Практики</CardTitle>
        </CardHeader>
        <CardContent>
          {card.practices.length === 0 ? (
            <p className="text-muted-foreground text-sm">Ни в одной практике</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Практика</TableHead>
                  <TableHead>Роль</TableHead>
                  <TableHead>С</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {card.practices.map((practice) => (
                  <TableRow key={practice.id}>
                    <TableCell>
                      <a
                        href={bookingPageUrl(practice.slug)}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {practice.name}
                      </a>
                      <span className="text-muted-foreground">
                        {" "}
                        /p/{practice.slug}
                      </span>
                    </TableCell>
                    <TableCell>{ROLE_LABELS[practice.role]}</TableCell>
                    <TableCell>{formatDate(practice.joinedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            Входы
            {signIns.total > signIns.items.length && (
              <Link
                href={
                  `/sign-ins?userId=${encodeURIComponent(user.id)}` as Route
                }
                className="text-muted-foreground text-sm font-normal hover:underline"
              >
                Все {signIns.total}
              </Link>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SignInTable items={signIns.items} showUser={false} />
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Платежи «Про»</CardTitle>
        </CardHeader>
        <CardContent>
          {card.payments.length === 0 ? (
            <p className="text-muted-foreground text-sm">Платежей не было</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>№</TableHead>
                  <TableHead>Период</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Оплачен</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {card.payments.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="tabular-nums">
                      {payment.number}
                    </TableCell>
                    <TableCell>{PERIOD_LABELS[payment.period]}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatKopecks(payment.amount)}
                    </TableCell>
                    <TableCell>
                      <PaymentStatus
                        status={payment.status}
                        refundedAt={payment.refundedAt}
                      />
                    </TableCell>
                    <TableCell>{formatDateTime(payment.paidAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
