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
import {
  BOOKING_ACCENT_LABELS,
  BOOKING_BACKDROP_LABELS,
  BOOKING_FONT_LABELS,
  BOOKING_QUESTION_KIND_LABELS,
  BOOKING_RADIUS_LABELS,
  PROFESSION_TERMS,
  readBookingTheme,
  WORKFLOW_PRESETS,
} from "@synoro/validators";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";

import { requireAdmin } from "~/auth/server";
import { PageHeader } from "~/components/page-header";
import { PlanBadge } from "~/components/plan-badge";
import { formatDate, formatDateTime } from "~/lib/format";
import { bookingPageUrl } from "~/lib/links";
import { api } from "~/orpc/server";

export const metadata: Metadata = { title: "Практика" };

const WEEKDAY_NAMES = [
  "Понедельник",
  "Вторник",
  "Среда",
  "Четверг",
  "Пятница",
  "Суббота",
  "Воскресенье",
];

/** 570 → «09:30». */
const formatMinutes = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const onOff = (value: boolean) => (value ? "включено" : "выключено");

export default function PracticePage(props: {
  params: Promise<{ id: string }>;
}) {
  return (
    <>
      <PageHeader title="Практика" />
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <Suspense
          fallback={["a", "b", "c"].map((key) => (
            <Skeleton key={key} className="h-64" />
          ))}
        >
          <PracticeCard params={props.params} />
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

async function PracticeCard({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const card = await api.practices.byId({ id }).catch((error: unknown) => {
    if (error instanceof ORPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const { practice, owner, plan } = card;
  const theme = readBookingTheme(practice.bookingTheme);
  const bookingUrl = bookingPageUrl(practice.slug);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {practice.name}
            <Badge variant="secondary">
              {PROFESSION_TERMS[practice.profession].label}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label="Адрес">
              <a
                href={bookingUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                /{practice.slug}
              </a>
            </Row>
            <Row label="Часовой пояс">{practice.timezone}</Row>
            <Row label="Владелец">
              <Link
                href={`/users/${owner.id}` as Route}
                className="hover:underline"
              >
                {owner.name}
              </Link>
              <span className="text-muted-foreground"> {owner.email}</span>
            </Row>
            <Row label="Создана">{formatDateTime(practice.createdAt)}</Row>
            <Row label="Обновлена">{formatDateTime(practice.updatedAt)}</Row>
            <Row label="Видео-комната">
              {practice.videoUrl ? (
                <a
                  href={practice.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  {practice.videoUrl}
                </a>
              ) : (
                "—"
              )}
            </Row>
            <Row label="Контакт для клиентов">
              {practice.clientContact ?? "—"}
            </Row>
            <Row label="ID">
              <code className="text-xs">{practice.id}</code>
            </Row>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Тариф владельца</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label="Сейчас">
              <PlanBadge plan={plan.status} />
            </Row>
            <Row label="Пробный до">{formatDate(plan.trialEndsAt)}</Row>
            <Row label="Оплачен до">{formatDate(plan.paidUntil)}</Row>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Запись</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label="Самостоятельная запись на знакомство">
              {onOff(practice.freeBookingEnabled)}
            </Row>
            <Row label="Длительность знакомства">
              {practice.introMinutes} мин
            </Row>
            <Row label="Оплата при визите">{onOff(practice.payAtVisit)}</Row>
            <Row label="Отмена клиентом за">{practice.cancelHours} ч</Row>
            <Row label="Поздняя отмена без возврата">
              {onOff(practice.lateCancel)}
            </Row>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Уведомления</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label="Напоминания клиентам">
              {onOff(practice.remindClients)}
            </Row>
            <Row label="О новых и отменённых записях сотрудникам">
              {onOff(practice.notifyStaff)}
            </Row>
            <Row label="Завтрашние записи в 20:00">
              {onOff(practice.dailyAgenda)}
            </Row>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Оформление страницы записи</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label="Акцент">{BOOKING_ACCENT_LABELS[theme.accent]}</Row>
            <Row label="Шрифт заголовков">
              {BOOKING_FONT_LABELS[theme.font]}
            </Row>
            <Row label="Углы">{BOOKING_RADIUS_LABELS[theme.radius]}</Row>
            <Row label="Фон">{BOOKING_BACKDROP_LABELS[theme.backdrop]}</Row>
            <Row label="О специалисте">{theme.about || "—"}</Row>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Анкета при записи</CardTitle>
        </CardHeader>
        <CardContent>
          {practice.bookingQuestions.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Вопросов нет — анкета не задаётся
            </p>
          ) : (
            <ol className="flex flex-col gap-2 text-sm">
              {practice.bookingQuestions.map((question, index) => (
                <li key={question.id} className="flex flex-col">
                  <span>
                    {index + 1}. {question.label}
                    <span className="text-muted-foreground">
                      {" "}
                      — {BOOKING_QUESTION_KIND_LABELS[question.kind]}
                      {question.required ? ", обязательный" : ""}
                    </span>
                  </span>
                  {question.kind === "choice" &&
                    question.options.length > 0 && (
                      <span className="text-muted-foreground text-xs">
                        {question.options.join(" · ")}
                      </span>
                    )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Услуги</CardTitle>
        </CardHeader>
        <CardContent>
          {card.services.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Услуг нет — действует час за один кредит
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead className="text-right">Минут</TableHead>
                  <TableHead className="text-right">Кредитов</TableHead>
                  <TableHead>Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {card.services.map((service) => (
                  <TableRow key={service.id}>
                    <TableCell>{service.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {service.minutes}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {service.credits}
                    </TableCell>
                    <TableCell>
                      {service.archived
                        ? "в архиве"
                        : service.active
                          ? "активна"
                          : "выключена"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Часы приёма ({practice.timezone})</CardTitle>
        </CardHeader>
        <CardContent>
          {card.availability.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Правил нет — слоты не открываются
            </p>
          ) : (
            <dl className="grid gap-x-8 sm:grid-cols-2">
              {WEEKDAY_NAMES.map((name, index) => {
                const rules = card.availability.filter(
                  (rule) => rule.weekday === index + 1,
                );
                return (
                  <div
                    key={name}
                    className="flex justify-between gap-4 border-b py-1.5 text-sm last:border-b-0"
                  >
                    <dt className="text-muted-foreground">{name}</dt>
                    <dd className="text-right">
                      {rules.length === 0
                        ? "—"
                        : rules
                            .map(
                              (rule) =>
                                `${formatMinutes(rule.startMinute)}–${formatMinutes(rule.endMinute)}`,
                            )
                            .join(", ")}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Свои сообщения клиентам</CardTitle>
        </CardHeader>
        <CardContent>
          {card.workflows.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Правил нет — автоматических писем клиентам не уходит
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Триггер</TableHead>
                  <TableHead>Условие</TableHead>
                  <TableHead>Тема</TableHead>
                  <TableHead>Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {card.workflows.map((workflow) => {
                  const preset = WORKFLOW_PRESETS[workflow.trigger];
                  return (
                    <TableRow key={workflow.id}>
                      <TableCell>{preset.title}</TableCell>
                      <TableCell>
                        {workflow.amount} {preset.amountUnit}
                      </TableCell>
                      <TableCell className="max-w-64 truncate">
                        {workflow.subject}
                      </TableCell>
                      <TableCell>
                        {workflow.active ? "включено" : "выключено"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Адрес страницы</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            <Row label="Текущий">/{practice.slug}</Row>
            <Row label="Прежние адреса">
              {card.formerSlugs.length === 0
                ? "—"
                : card.formerSlugs.map((slug) => `/${slug}`).join(", ")}
            </Row>
            {card.domain && (
              <>
                <Row label="Свой домен">{card.domain.hostname}</Row>
                <Row label="Статус домена">
                  {card.domain.status === "active"
                    ? "подтверждён"
                    : "ожидает проверки"}
                  {card.domain.securedAt &&
                    `, https с ${formatDate(card.domain.securedAt)}`}
                </Row>
              </>
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Google Календарь</CardTitle>
        </CardHeader>
        <CardContent>
          {card.googleCalendar ? (
            <dl className="divide-y">
              <Row label="Аккаунт">{card.googleCalendar.email}</Row>
              <Row label="Записи в календарь">
                {onOff(card.googleCalendar.exportBookings)}
              </Row>
              <Row label="Подключён">
                {formatDateTime(card.googleCalendar.createdAt)}
              </Row>
              {card.googleCalendar.lastError && (
                <Row label="Последняя ошибка">
                  <span className="text-destructive">
                    {card.googleCalendar.lastError}
                  </span>
                </Row>
              )}
            </dl>
          ) : (
            <p className="text-muted-foreground text-sm">Не подключён</p>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>
            Сотрудники и клиенты — {card.staff.length} сотру.{" "}
            <span className="text-muted-foreground font-normal">
              клиентов: {card.clients}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Имя</TableHead>
                <TableHead>Почта</TableHead>
                <TableHead>Роль</TableHead>
                <TableHead>С</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {card.staff.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <Link
                      href={`/users/${member.userId}` as Route}
                      className="hover:underline"
                    >
                      {member.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {member.email}
                  </TableCell>
                  <TableCell>
                    {member.role === "owner" ? "владелец" : "администратор"}
                  </TableCell>
                  <TableCell>{formatDate(member.joinedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
