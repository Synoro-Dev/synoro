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
 * - reminder-hour — the meeting is within the hour;
 * - cancelled     — the client or the specialist cancelled it.
 */
export type BookingNotice =
  | "confirmed"
  | "link"
  | "reminder-day"
  | "reminder-hour"
  | "cancelled";

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
    title: "Встреча в ближайшие 24 часа",
  },
  "reminder-hour": {
    badge: "Напоминание",
    tone: "warning",
    title: "Встреча через час",
  },
  cancelled: {
    badge: "Запись отменена",
    tone: "warning",
    title: "Запись отменена",
  },
};

/**
 * Sent to a client about their booking: confirmation, the video link (set or
 * changed by the specialist), reminders and cancellation. The link is
 * optional — the other mails go out without it — and never shown once the
 * booking is cancelled.
 */
export default function BookingNoticeEmail({
  notice = "confirmed",
  name = "Иван",
  practiceName = "Анна Иванова",
  when = "понедельник, 7 января, 10:00",
  videoUrl = "https://company.ktalk.ru/room",
  cabinetUrl = "https://synoro.ru/bookings",
  cancelledBy = null,
  refunded = false,
}: {
  notice: BookingNotice;
  name: string;
  practiceName: string;
  /** Start of the booking, already formatted in the practice's time zone. */
  when: string;
  /** The video room, or null when the specialist has not set one. */
  videoUrl: string | null;
  cabinetUrl: string;
  /** Who cancelled, for `cancelled`. */
  cancelledBy?: "client" | "specialist" | null;
  /** The consultation went back to the balance, for `cancelled`. */
  refunded?: boolean;
}) {
  const copy = COPY[notice];
  const cancelled = notice === "cancelled";
  return (
    <EmailLayout
      preview={`${copy.title}: ${practiceName}, ${when}`}
      footnote={`Вы получили это письмо, потому что записаны к специалисту через ${APP_CONFIG.shortName}.`}
    >
      <EmailHeader
        badge={<EmailBadge tone={copy.tone}>{copy.badge}</EmailBadge>}
        title={copy.title}
        description={
          cancelled
            ? `Здравствуйте, ${name}! ${cancelledBy === "specialist" ? "Специалист отменил" : "Вы отменили"} запись: ${practiceName}, ${when}.`
            : `Здравствуйте, ${name}! Встреча с ${practiceName} — ${when}.`
        }
      />
      {cancelled ? (
        <EmailText>
          {refunded
            ? "Занятие вернулось на баланс — запишитесь на другое время, когда будет удобно."
            : "Занятие не вернулось на баланс. Если это ошибка, свяжитесь со специалистом."}
        </EmailText>
      ) : null}
      {videoUrl && !cancelled ? (
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
