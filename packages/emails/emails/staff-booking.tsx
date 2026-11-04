import { APP_CONFIG } from "@synoro/config";

import { EmailLayout } from "../components/email-layout";
import {
  EmailBadge,
  EmailButton,
  EmailHeader,
  EmailText,
} from "../components/email-ui";

/**
 * booked — someone booked (or was booked); moved — it got another time;
 * cancelled — it was cancelled.
 */
export type StaffBookingNotice = "booked" | "moved" | "cancelled";

const COPY: Record<
  StaffBookingNotice,
  { title: string; tone: "success" | "info" | "warning" }
> = {
  booked: { title: "Новая запись", tone: "success" },
  moved: { title: "Запись перенесена", tone: "info" },
  cancelled: { title: "Запись отменена", tone: "warning" },
};

/**
 * Sent to the specialist and the administrators of a practice when a booking
 * is made, moved or cancelled by someone else.
 */
export default function StaffBookingEmail({
  notice = "booked",
  practiceName = "Анна Иванова",
  clientName = "Иван Петров",
  clientPhone = "+7 900 000-00-00",
  when = "понедельник, 7 января, 10:00",
  free = false,
  cancelledBy = null,
  refunded = false,
  movedFrom = null,
  movedBy = null,
  calendarUrl = "https://app.synoro.ru/practices/1/calendar",
  dates = [],
}: {
  notice: StaffBookingNotice;
  practiceName: string;
  clientName: string;
  clientPhone: string | null;
  /** Start of the booking, formatted in the practice's time zone. */
  when: string;
  /** A free first meeting rather than a paid consultation. */
  free: boolean;
  /** Who cancelled, for `cancelled`. */
  cancelledBy?: "client" | "staff" | null;
  /** The consultation went back to the client's balance, for `cancelled`. */
  refunded?: boolean;
  /** The old time, formatted like `when`, for `moved`. */
  movedFrom?: string | null;
  /** Who moved it, for `moved`. */
  movedBy?: "client" | "staff" | null;
  calendarUrl: string;
  /**
   * Every date of a recurring booking, formatted like `when`; `when` then
   * sums them up («8 встреч, первая — …»).
   */
  dates?: string[];
}) {
  const booked = notice === "booked";
  const cancelled = notice === "cancelled";
  const series = dates.length > 1;
  const { title, tone } = COPY[notice];
  const kind = free
    ? "Бесплатная встреча"
    : series
      ? "Повторная запись"
      : "Запись";
  return (
    <EmailLayout
      preview={`${title}: ${clientName}, ${when}`}
      footnote={`Вы получили это письмо, потому что ведёте практику «${practiceName}» в ${APP_CONFIG.shortName}.`}
    >
      <EmailHeader
        badge={<EmailBadge tone={tone}>{title}</EmailBadge>}
        title={`${clientName} — ${when}`}
        description={
          booked
            ? `${kind} в практике «${practiceName}».`
            : cancelled
              ? `${kind} в практике «${practiceName}» отменена${cancelledBy === "client" ? " клиентом" : ""}.`
              : `${kind} в практике «${practiceName}» перенесена${movedBy === "client" ? " клиентом" : ""}. Прежнее время: ${movedFrom}.`
        }
      />
      {clientPhone ? <EmailText>Телефон: {clientPhone}</EmailText> : null}
      {series ? (
        <EmailText>
          {booked ? "Даты:" : "Отменены даты:"}
          <br />
          {dates.map((date) => (
            <span key={date}>
              {date}
              <br />
            </span>
          ))}
        </EmailText>
      ) : null}
      {cancelled && !free ? (
        <EmailText muted>
          {refunded
            ? `${series ? "Занятия вернулись" : "Занятие вернулось"} клиенту на баланс.`
            : `${series ? "Занятия не возвращены" : "Занятие не возвращено"} на баланс.`}
        </EmailText>
      ) : null}
      <EmailButton href={calendarUrl}>Открыть календарь</EmailButton>
    </EmailLayout>
  );
}
