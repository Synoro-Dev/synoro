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
 * Sent to the address a visitor left for a practice's waiting list: the wish
 * is saved and the address is written to only once its owner follows the link.
 * Anyone can type an address into the form, so the mail says what happens if
 * it was not them (nothing) and carries neither the typed name nor any other
 * text the sender chose — only the practice's name.
 */
export default function WaitlistConfirmEmail({
  practiceName = "Анна Иванова",
  confirmUrl = "https://synoro.ru/b/w/token",
  hours = 24,
}: {
  practiceName: string;
  /** The page that confirms the wish. */
  confirmUrl: string;
  /** How long the link works. */
  hours: number;
}) {
  return (
    <Html lang="ru">
      <Head />
      <Preview>Подтвердите лист ожидания: {practiceName}</Preview>
      <Tailwind config={emailTailwindConfig}>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-[40px] w-[465px] rounded border border-solid border-[#eaeaea] p-[20px]">
            <Heading className="mx-0 my-[30px] p-0 text-center text-[24px] font-normal text-black">
              Подтвердите лист ожидания
            </Heading>
            <Text className="text-[14px] leading-[24px] text-black">
              Здравствуйте! Этот адрес указали в листе ожидания у{" "}
              <strong>{practiceName}</strong>. Если это были вы, подтвердите — и
              мы один раз напишем, когда освободится подходящее время.
            </Text>
            <Section className="mb-[32px] mt-[32px] text-center">
              <Button
                className="rounded bg-[#000000] px-5 py-3 text-center text-[14px] font-semibold text-white no-underline"
                href={confirmUrl}
              >
                Подтвердить
              </Button>
            </Section>
            <Hr className="mx-0 my-[26px] w-full border border-solid border-[#eaeaea]" />
            <Text className="text-[12px] leading-[24px] text-[#666666]">
              Ссылка действует {hours} ч. Если вы ничего не оставляли, просто
              проигнорируйте письмо: без подтверждения мы вам не напишем, а
              пожелание удалится само. {APP_CONFIG.shortName}
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
