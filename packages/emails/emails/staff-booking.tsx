import { APP_CONFIG } from "@synoro/config";

import { EmailLayout } from "../components/email-layout";
import {
  EmailBadge,
  EmailButton,
  EmailHeader,
  EmailText,
} from "../components/email-ui";

/** booked — someone booked (or was booked); cancelled — it was cancelled. */
export type StaffBookingNotice = "booked" | "cancelled";

/**
 * Sent to the specialist and the administrators of a practice when a booking
 * is made or cancelled by someone else.
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
  calendarUrl = "https://app.synoro.ru/practices/1/calendar",
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
  calendarUrl: string;
}) {
  const booked = notice === "booked";
  const title = booked ? "Новая запись" : "Запись отменена";
  const kind = free ? "Бесплатная встреча" : "Запись";
  return (
    <EmailLayout
      preview={`${title}: ${clientName}, ${when}`}
      footnote={`Вы получили это письмо, потому что ведёте практику «${practiceName}» в ${APP_CONFIG.shortName}.`}
    >
      <EmailHeader
        badge={
          <EmailBadge tone={booked ? "success" : "warning"}>{title}</EmailBadge>
        }
        title={`${clientName} — ${when}`}
        description={
          booked
            ? `${kind} в практике «${practiceName}».`
            : `${kind} в практике «${practiceName}» отменена${cancelledBy === "client" ? " клиентом" : ""}.`
        }
      />
      {clientPhone ? <EmailText>Телефон: {clientPhone}</EmailText> : null}
      {!booked && !free ? (
        <EmailText muted>
          {refunded
            ? "Занятие вернулось клиенту на баланс."
            : "Занятие не возвращено на баланс."}
        </EmailText>
      ) : null}
      <EmailButton href={calendarUrl}>Открыть календарь</EmailButton>
    </EmailLayout>
  );
}
