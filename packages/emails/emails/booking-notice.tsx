import { APP_CONFIG } from "@synoro/config";

import { EmailLayout } from "../components/email-layout";
import {
  EmailBadge,
  EmailButton,
  EmailHeader,
  EmailLinkFallback,
  EmailText,
} from "../components/email-ui";

/**
 * What the email is about:
 * - confirmed     — the booking is paid and confirmed;
 * - link          — the specialist set or changed the video link;
 * - reminder-day  — the meeting is within a day;
 * - reminder-hour — the meeting is within the hour.
 */
export type BookingNotice =
  | "confirmed"
  | "link"
  | "reminder-day"
  | "reminder-hour";

const COPY: Record<
  BookingNotice,
  { badge: string; tone: "success" | "info" | "warning"; title: string }
> = {
  confirmed: {
    badge: "Запись подтверждена",
    tone: "success",
    title: "Вы записаны",
  },
  link: {
    badge: "Видеовстреча",
    tone: "info",
    title: "Ссылка на видеовстречу",
  },
  "reminder-day": {
    badge: "Напоминание",
    tone: "info",
    title: "Встреча уже завтра",
  },
  "reminder-hour": {
    badge: "Напоминание",
    tone: "warning",
    title: "Встреча через час",
  },
};

/**
 * Sent to a client about a confirmed booking: confirmation, the video link
 * (set or changed by the specialist) and reminders with it. The link is
 * optional — a confirmation goes out even when the specialist has none yet.
 */
export default function BookingNoticeEmail({
  notice = "confirmed",
  name = "Иван",
  practiceName = "Анна Иванова",
  when = "понедельник, 7 января, 10:00",
  videoUrl = "https://company.ktalk.ru/room",
  cabinetUrl = "https://synoro.ru/bookings",
}: {
  notice: BookingNotice;
  name: string;
  practiceName: string;
  /** Start of the booking, already formatted in the practice's time zone. */
  when: string;
  /** The video room, or null when the specialist has not set one. */
  videoUrl: string | null;
  cabinetUrl: string;
}) {
  const copy = COPY[notice];
  return (
    <EmailLayout
      preview={`${copy.title}: ${practiceName}, ${when}`}
      footnote={`Вы получили это письмо, потому что записаны к специалисту через ${APP_CONFIG.shortName}.`}
    >
      <EmailHeader
        badge={<EmailBadge tone={copy.tone}>{copy.badge}</EmailBadge>}
        title={copy.title}
        description={`Здравствуйте, ${name}! Встреча с ${practiceName} — ${when}.`}
      />
      {videoUrl ? (
        <>
          <EmailText>
            Встреча пройдёт по видеосвязи: в назначенное время откройте ссылку.
          </EmailText>
          <EmailButton href={videoUrl}>Войти на встречу</EmailButton>
          <EmailLinkFallback href={videoUrl} />
        </>
      ) : null}
      <EmailText muted>
        Все ваши записи и ссылки на встречи — в личном кабинете:{" "}
        <a href={cabinetUrl}>{cabinetUrl}</a>
      </EmailText>
    </EmailLayout>
  );
}
