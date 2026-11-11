import {
  Button,
  Column,
  Heading,
  Link,
  Row,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

// Email-safe takes on ReUI's Badge / Alert / Button. Class names stay plain
// strings: react-email inlines them, so no `cn` and no runtime variants.

type Tone = "primary" | "success" | "info" | "warning" | "destructive";

// ReUI `<tone>-light` badge: tinted fill, hairline border, dark text.
const badgeTone: Record<Tone | "outline", string> = {
  primary: "border-primary-tint bg-primary-tint text-primary",
  success: "border-success-border bg-success-tint text-success-foreground",
  info: "border-info-border bg-info-tint text-info-foreground",
  warning: "border-warning-border bg-warning-tint text-warning-foreground",
  destructive:
    "border-destructive-border bg-destructive-tint text-destructive-foreground",
  outline: "border-border bg-background text-foreground",
};

export function EmailBadge({
  tone = "primary",
  children,
}: {
  tone?: Tone | "outline";
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-block rounded-md border border-solid px-2 py-0.5 font-medium text-xs ${badgeTone[tone]}`}
    >
      {children}
    </span>
  );
}

/** Badge, title and lead paragraph at the top of the card. */
export function EmailHeader({
  badge,
  title,
  description,
}: {
  badge?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <Section className="mb-6">
      {badge ? <Text className="m-0 mb-4">{badge}</Text> : null}
      <Heading
        as="h1"
        className="m-0 font-semibold text-2xl text-foreground tracking-[-0.02em]"
      >
        {title}
      </Heading>
      {description ? (
        <Text className="m-0 mt-2 text-muted-foreground text-sm leading-[22px]">
          {description}
        </Text>
      ) : null}
    </Section>
  );
}

export function EmailText({
  muted = false,
  children,
}: {
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <Text
      className={`my-4 text-sm leading-[22px] ${muted ? "text-muted-foreground" : "text-foreground"}`}
    >
      {children}
    </Text>
  );
}

export function EmailButton({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Section className="my-6">
      <Button
        href={href}
        className="rounded-lg bg-primary px-5 py-3 text-center font-medium text-primary-foreground text-sm no-underline"
      >
        {children}
      </Button>
    </Section>
  );
}

/** The raw URL under a button, for clients that break the button. */
export function EmailLinkFallback({ href }: { href: string }) {
  return (
    <Section className="my-6 border-0 border-border border-t border-solid pt-6">
      <Text className="m-0 text-muted-foreground text-xs">
        Кнопка не работает? Скопируйте ссылку в браузер:
      </Text>
      <Section className="mt-2 rounded-lg border border-border border-solid bg-muted px-3 py-2.5">
        <Link
          href={href}
          className="font-mono text-foreground text-xs no-underline"
          style={{ wordBreak: "break-all" }}
        >
          {href}
        </Link>
      </Section>
    </Section>
  );
}

/** A one-time code, large and monospaced, in one copyable run. */
export function EmailCode({
  code,
  caption,
}: {
  code: string;
  caption?: ReactNode;
}) {
  return (
    <Section className="my-6 rounded-xl border border-border border-solid bg-muted px-6 py-6 text-center">
      <Text className="m-0 font-medium text-muted-foreground text-xs uppercase tracking-[0.08em]">
        Ваш код
      </Text>
      {/* Left padding offsets the trailing letter-spacing so it centres. */}
      <Text className="m-0 mt-3 pl-[10px] font-mono font-semibold text-[36px] text-foreground leading-[44px] tracking-[10px]">
        {code}
      </Text>
      {caption ? (
        <Text className="m-0 mt-3 text-muted-foreground text-xs">
          {caption}
        </Text>
      ) : null}
    </Section>
  );
}

const alertTone: Record<Exclude<Tone, "primary">, string> = {
  success: "border-success-border bg-success-tint",
  info: "border-info-border bg-info-tint",
  warning: "border-warning-border bg-warning-tint",
  destructive: "border-destructive-border bg-destructive-tint",
};

const alertText: Record<Exclude<Tone, "primary">, string> = {
  success: "text-success-foreground",
  info: "text-info-foreground",
  warning: "text-warning-foreground",
  destructive: "text-destructive-foreground",
};

/** ReUI `<Alert variant>`: a tinted block for a note the reader must see. */
export function EmailAlert({
  tone = "info",
  title,
  children,
}: {
  tone?: Exclude<Tone, "primary">;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Section
      className={`my-6 rounded-lg border border-solid px-4 py-3 ${alertTone[tone]}`}
    >
      <Text className={`m-0 font-medium text-sm ${alertText[tone]}`}>
        {title}
      </Text>
      {children ? (
        <Text className={`m-0 mt-1 text-sm leading-[20px] ${alertText[tone]}`}>
          {children}
        </Text>
      ) : null}
    </Section>
  );
}

/** Numbered steps, each a title with a muted line under it. */
export function EmailSteps({
  steps,
}: {
  steps: { title: string; description: ReactNode }[];
}) {
  return (
    <Section className="my-6">
      {steps.map((step, index) => (
        <Row key={step.title} className={index > 0 ? "mt-4" : undefined}>
          <Column style={{ width: 24, verticalAlign: "top" }}>
            <Text className="m-0 h-[22px] w-[22px] rounded-full border border-border border-solid bg-background text-center font-medium text-foreground text-xs leading-[22px]">
              {index + 1}
            </Text>
          </Column>
          <Column className="pl-3" style={{ verticalAlign: "top" }}>
            <Text className="m-0 font-medium text-foreground text-sm leading-[22px]">
              {step.title}
            </Text>
            <Text className="m-0 text-muted-foreground text-sm leading-[20px]">
              {step.description}
            </Text>
          </Column>
        </Row>
      ))}
    </Section>
  );
}
