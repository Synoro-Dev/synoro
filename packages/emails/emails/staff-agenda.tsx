import { Column, Row, Section, Text } from "@react-email/components";
import { APP_CONFIG } from "@synoro/config";

import { EmailLayout } from "../components/email-layout";
import {
  EmailBadge,
  EmailButton,
  EmailHeader,
  EmailText,
} from "../components/email-ui";

/** One meeting in the evening summary, formatted in the practice's zone. */
export interface AgendaMeeting {
  /** «10:00–11:00». */
  time: string;
  clientName: string;
  clientPhone: string | null;
  /** A free first meeting rather than a paid consultation. */
  free: boolean;
}

/**
 * «Расписание на завтра»: sent to the specialist and the administrators of a
 * practice at 20:00 its time, when the next day has bookings.
 */
export default function StaffAgendaEmail({
  practiceName = "Анна Иванова",
  date = "среда, 4 ноября",
  meetings = [
    {
      time: "10:00–11:00",
      clientName: "Иван Петров",
      clientPhone: "+7 900 000-00-00",
      free: false,
    },
    {
      time: "12:00–12:30",
      clientName: "Мария",
      clientPhone: null,
      free: true,
    },
  ],
  calendarUrl = "https://app.synoro.ru/practices/1/calendar",
}: {
  practiceName: string;
  /** The day, «среда, 4 ноября». */
  date: string;
  meetings: AgendaMeeting[];
  calendarUrl: string;
}) {
  return (
    <EmailLayout
      preview={`Завтра, ${date}: ${meetings.length} в расписании`}
      footnote={`Вы получили это письмо, потому что ведёте практику «${practiceName}» в ${APP_CONFIG.shortName}. Отключить сводку можно в разделе «Сообщения» практики.`}
    >
      <EmailHeader
        badge={<EmailBadge tone="info">Расписание на завтра</EmailBadge>}
        title={date}
        description={`Записи в практике «${practiceName}».`}
      />
      <Section className="my-4">
        {meetings.map((meeting, index) => (
          <Row
            key={`${meeting.time}-${meeting.clientName}`}
            className={
              index > 0
                ? "border-0 border-border border-t border-solid"
                : undefined
            }
          >
            <Column
              className="py-3 pr-3 font-medium text-foreground text-sm"
              style={{ width: 104, verticalAlign: "top" }}
            >
              {meeting.time}
            </Column>
            <Column className="py-3" style={{ verticalAlign: "top" }}>
              <Text className="m-0 text-foreground text-sm leading-[22px]">
                {meeting.clientName}
                {meeting.free ? " · бесплатная встреча" : ""}
              </Text>
              {meeting.clientPhone ? (
                <Text className="m-0 text-muted-foreground text-sm leading-[20px]">
                  {meeting.clientPhone}
                </Text>
              ) : null}
            </Column>
          </Row>
        ))}
      </Section>
      <EmailText muted>
        Если планы изменились, отмените запись в календаре — клиент получит
        уведомление.
      </EmailText>
      <EmailButton href={calendarUrl}>Открыть календарь</EmailButton>
    </EmailLayout>
  );
}
