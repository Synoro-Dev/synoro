import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import { APP_CONFIG } from "@synoro/config";

import { emailTailwindConfig } from "../tailwind";

/**
 * Sent to a visitor who booked without an account: the link that opens their
 * booking (status, cancel) with no sign-in, and how to reach the cabinet.
 */
export default function BookingLinkEmail({
  name = "Иван",
  practiceName = "Анна Иванова",
  when = "понедельник, 7 января, 10:00",
  holdUntil = "10:15",
  bookingUrl = "https://synoro.ru/b/token",
  cabinetUrl = "https://synoro.ru/bookings",
}: {
  name: string;
  practiceName: string;
  /** Start of the booking, already formatted in the practice's time zone. */
  when: string;
  /** Until when the time is held for payment, same zone. */
  holdUntil: string;
  bookingUrl: string;
  cabinetUrl: string;
}) {
  return (
    <Html lang="ru">
      <Head />
      <Preview>Ваша запись: {practiceName}</Preview>
      <Tailwind config={emailTailwindConfig}>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-[40px] w-[465px] rounded border border-solid border-[#eaeaea] p-[20px]">
            <Heading className="mx-0 my-[30px] p-0 text-center text-[24px] font-normal text-black">
              Ваша запись
            </Heading>
            <Text className="text-[14px] leading-[24px] text-black">
              Здравствуйте, {name}!
            </Text>
            <Text className="text-[14px] leading-[24px] text-black">
              Вы записались к <strong>{practiceName}</strong> на{" "}
              <strong>{when}</strong>. Время удержано до {holdUntil} — за это
              время нужно оплатить запись, после этого она подтвердится.
            </Text>
            <Section className="mb-[32px] mt-[32px] text-center">
              <Button
                className="rounded bg-[#000000] px-5 py-3 text-center text-[14px] font-semibold text-white no-underline"
                href={bookingUrl}
              >
                Открыть запись
              </Button>
            </Section>
            <Text className="text-[14px] leading-[24px] text-black">
              По этой ссылке запись открывается без входа: там её статус и
              отмена. Сохраните письмо.
            </Text>
            <Text className="text-[14px] leading-[24px] text-black">
              Личный кабинет с записями и оплатами —{" "}
              <Link href={cabinetUrl} className="text-black">
                по этой ссылке
              </Link>
              : войдите по коду, который придёт на этот адрес.
            </Text>
            <Hr className="mx-0 my-[26px] w-full border border-solid border-[#eaeaea]" />
            <Text className="text-[12px] leading-[24px] text-[#666666]">
              Если вы не записывались, просто проигнорируйте письмо — без оплаты
              запись не подтвердится. {APP_CONFIG.shortName}
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
