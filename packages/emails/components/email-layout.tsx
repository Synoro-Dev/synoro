import {
  Body,
  Column,
  Container,
  Head,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import { APP_CONFIG, env } from "@synoro/config";
import type { ReactNode } from "react";

import { emailTailwindConfig } from "../tailwind";

const appHost = env.APP_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");

/**
 * The shell every email shares: brand mark, a ReUI-style card for the
 * content, and a muted footer. Templates only fill the card.
 */
export function EmailLayout({
  preview,
  footnote = "Это автоматическое письмо — отвечать на него не нужно.",
  children,
}: {
  /** Inbox preview line, shown next to the subject. */
  preview: string;
  /** First footer line: why the recipient got this email. */
  footnote?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Html lang="ru">
      <Tailwind config={emailTailwindConfig}>
        <Head>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="color-scheme" content="light" />
          <meta name="supported-color-schemes" content="light" />
          {/* Clients that load web fonts (Apple Mail, iOS) get Geist. */}
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;600&display=swap"
          />
        </Head>
        <Preview>{preview}</Preview>
        <Body className="m-0 bg-canvas py-10 font-sans text-foreground">
          <Container className="mx-auto w-full max-w-[520px] px-4">
            <Section className="mb-6 px-1">
              <Row>
                <Column style={{ width: 28 }}>
                  <Text className="m-0 h-[28px] w-[28px] rounded-md bg-primary text-center font-semibold text-primary-foreground text-sm leading-[28px]">
                    {APP_CONFIG.shortName.charAt(0).toUpperCase()}
                  </Text>
                </Column>
                <Column className="pl-2.5">
                  <Link
                    href={env.APP_URL}
                    className="font-semibold text-foreground text-sm no-underline"
                  >
                    {APP_CONFIG.name}
                  </Link>
                </Column>
              </Row>
            </Section>

            <Section
              className="rounded-xl border border-border border-solid bg-card px-7 pt-8 pb-2"
              style={{ boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)" }}
            >
              {children}
            </Section>

            <Section className="px-1 pt-6">
              <Text className="m-0 text-muted-foreground text-xs">
                {footnote}
              </Text>
              <Text className="m-0 mt-2 text-muted-foreground text-xs">
                <Link
                  href={env.APP_URL}
                  className="text-muted-foreground underline"
                >
                  {appHost}
                </Link>
                {"  ·  "}© {new Date().getFullYear()} {APP_CONFIG.name}
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
