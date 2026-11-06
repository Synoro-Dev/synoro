import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import { APP_CONFIG } from "@synoro/config";

import { emailTailwindConfig } from "../tailwind";

/**
 * Sent to someone on a practice's waiting list when time that fits their wish
 * frees up. The time is not held for them: whoever books it first gets it.
 */
export default function WaitlistNoticeEmail({
  name = "Иван",
  practiceName = "Анна Иванова",
  when = "понедельник, 7 января, 10:00 (Москва)",
  bookingUrl = "https://synoro.ru/anna",
}: {
  name: string;
  practiceName: string;
  /** The freed time, already formatted with its time zone. */
  when: string;
  /** The practice's booking page. */
  bookingUrl: string;
}) {
  return (
    <Html lang="ru">
      <Head />
      <Preview>Освободилось время: {practiceName}</Preview>
      <Tailwind config={emailTailwindConfig}>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-[40px] w-[465px] rounded border border-solid border-[#eaeaea] p-[20px]">
            <Heading className="mx-0 my-[30px] p-0 text-center text-[24px] font-normal text-black">
              Освободилось время
            </Heading>
            <Text className="text-[14px] leading-[24px] text-black">
              Здравствуйте, {name}!
            </Text>
            <Text className="text-[14px] leading-[24px] text-black">
              Вы ждали время у <strong>{practiceName}</strong> — освободилось{" "}
              <strong>{when}</strong>.
            </Text>
            <Text className="text-[14px] leading-[24px] text-black">
              Время ни за кем не закреплено: записывается тот, кто успел первым.
            </Text>
            <Section className="mb-[32px] mt-[32px] text-center">
              <Button
                className="rounded bg-[#000000] px-5 py-3 text-center text-[14px] font-semibold text-white no-underline"
                href={bookingUrl}
              >
                Выбрать время
              </Button>
            </Section>
            <Hr className="mx-0 my-[26px] w-full border border-solid border-[#eaeaea]" />
            <Text className="text-[12px] leading-[24px] text-[#666666]">
              Вы получили это письмо один раз, потому что встали в лист
              ожидания. Если время уже занято, оставьте новое пожелание на
              странице записи. {APP_CONFIG.shortName}
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
