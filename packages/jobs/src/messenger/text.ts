import type { TemplateEmail } from "@synoro/emails";

import { describeDates } from "../when";
import { actionData } from "./actions";
import type { MessengerMessage } from "./bots";

/**
 * The same notice as the mail, written for a messenger: short, plain text
 * (no markup to escape), links as buttons. Like the mail it names only the
 * practice, the time and the link — nothing about the service.
 */

type Props<T extends TemplateEmail["template"]> = Extract<
  TemplateEmail,
  { template: T }
>["props"];

function bookingNotice(
  p: Props<"booking-notice">,
  cancelBookingId: string | undefined,
): MessengerMessage {
  const series = (p.dates?.length ?? 0) > 1;
  const titles = {
    confirmed: "Вы записаны",
    link: "Ссылка на видеовстречу",
    "reminder-day": "Напоминание: встреча в ближайшие 24 часа",
    "reminder-hour": "Напоминание: встреча через час",
    cancelled: "Запись отменена",
    moved: "Запись перенесена",
  } as const;
  const lines = [`${titles[p.notice]}`];
  if (p.notice === "cancelled") {
    lines.push(
      `${p.cancelledBy === "specialist" ? "Специалист отменил" : "Вы отменили"} запись: ${p.practiceName}, ${p.when}.`,
    );
    if (!p.free) {
      lines.push(
        p.refunded
          ? `${series ? "Занятия вернулись" : "Занятие вернулось"} на баланс.`
          : `${series ? "Занятия не вернулись" : "Занятие не вернулось"} на баланс. Если это ошибка, свяжитесь со специалистом.`,
      );
    }
  } else if (p.notice === "moved") {
    lines.push(
      `${p.movedBy === "specialist" ? "Специалист перенёс" : "Вы перенесли"} запись: ${p.practiceName}, ${p.when}.`,
      `Прежнее время: ${p.movedFrom}.`,
    );
  } else {
    lines.push(`${p.practiceName} — ${p.when}.`);
  }
  if (series) lines.push(`Все даты:\n${p.dates?.join("\n")}`);
  const buttons: MessengerMessage["buttons"] = [];
  if (p.videoUrl && p.notice !== "cancelled") {
    buttons.push({ text: "Войти на встречу", url: p.videoUrl });
  }
  if (cancelBookingId && p.notice !== "cancelled" && !series) {
    buttons.push({
      text: "Отменить запись",
      action: actionData({ kind: "cancel", bookingId: cancelBookingId }),
    });
  }
  buttons.push({ text: "Мои записи", url: p.cabinetUrl });
  return { text: lines.join("\n"), buttons };
}

function staffBooking(p: Props<"staff-booking">): MessengerMessage {
  const booked = p.notice === "booked";
  const cancelled = p.notice === "cancelled";
  const series = (p.dates?.length ?? 0) > 1;
  const kind = p.free
    ? "Бесплатная встреча"
    : series
      ? "Повторная запись"
      : "Запись";
  const titles = {
    booked: "Новая запись",
    moved: "Запись перенесена",
    cancelled: "Запись отменена",
  } as const;
  const lines = [
    `${titles[p.notice]}: ${p.clientName} — ${p.when}`,
    booked
      ? `${kind} в практике «${p.practiceName}».`
      : cancelled
        ? `${kind} в практике «${p.practiceName}» отменена${p.cancelledBy === "client" ? " клиентом" : ""}.`
        : `${kind} в практике «${p.practiceName}» перенесена${p.movedBy === "client" ? " клиентом" : ""}. Прежнее время: ${p.movedFrom}.`,
  ];
  if (p.clientPhone) lines.push(`Телефон: ${p.clientPhone}`);
  if (series) {
    lines.push(`${booked ? "Даты" : "Отменены даты"}:\n${p.dates?.join("\n")}`);
  }
  if (cancelled && !p.free) {
    lines.push(
      p.refunded
        ? `${series ? "Занятия вернулись" : "Занятие вернулось"} клиенту на баланс.`
        : `${series ? "Занятия не возвращены" : "Занятие не возвращено"} на баланс.`,
    );
  }
  return {
    text: lines.join("\n"),
    buttons: [{ text: "Открыть календарь", url: p.calendarUrl }],
  };
}

/**
 * «Точно отменить?» after «Отменить запись»: the booking named again, what
 * happens to the consultation, and the two answers.
 */
export function cancelPrompt(booking: {
  id: string;
  kind: string;
  startsAt: Date;
  practiceName: string;
  timezone: string;
}): MessengerMessage {
  const { when } = describeDates([booking.startsAt], booking.timezone);
  const lines = ["Отменить запись?", `${booking.practiceName} — ${when}.`];
  if (booking.kind !== "free") lines.push("Занятие вернётся на баланс.");
  return {
    text: lines.join("\n"),
    buttons: [
      {
        text: "Да, отменить",
        action: actionData({ kind: "cancel-confirmed", bookingId: booking.id }),
      },
      { text: "Нет, оставить", action: actionData({ kind: "keep" }) },
    ],
  };
}

function staffAgenda(p: Props<"staff-agenda">): MessengerMessage {
  const lines = p.meetings.map((m) =>
    [
      `${m.time} — ${m.clientName}`,
      m.free ? " (бесплатная встреча)" : "",
      m.clientPhone ? `, ${m.clientPhone}` : "",
    ].join(""),
  );
  return {
    text: `Расписание на завтра, ${p.date}\nПрактика «${p.practiceName}»\n\n${lines.join("\n")}`,
    buttons: [{ text: "Открыть календарь", url: p.calendarUrl }],
  };
}

function workflowMessage(p: Props<"workflow-message">): MessengerMessage {
  // One bot writes for every practice: say whose message it is.
  return {
    text: `${p.title}\nСообщение от: ${p.practiceName}\n\n${p.text}`,
    buttons: [],
  };
}

/**
 * The messenger version of `email`, or null for mails that only go by mail
 * (sign-in codes, «Про» notices and the like). A client's notice about a
 * booking they may still cancel (`cancelBookingId`) gets «Отменить запись».
 */
export function messengerMessage(
  email: TemplateEmail,
  options: { cancelBookingId?: string } = {},
): MessengerMessage | null {
  switch (email.template) {
    case "booking-notice":
      return bookingNotice(email.props, options.cancelBookingId);
    case "staff-agenda":
      return staffAgenda(email.props);
    case "staff-booking":
      return staffBooking(email.props);
    case "workflow-message":
      return workflowMessage(email.props);
    default:
      return null;
  }
}
