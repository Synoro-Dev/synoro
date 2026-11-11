import { APP_CONFIG } from "@synoro/config";

import { EmailLayout } from "../components/email-layout";
import {
  EmailBadge,
  EmailButton,
  EmailHeader,
  EmailText,
} from "../components/email-ui";

/** user — a new account; practice — a new practice. */
export type TeamNoticeKind = "user" | "practice";

const COPY: Record<TeamNoticeKind, { badge: string; title: string }> = {
  user: { badge: "Новый пользователь", title: "Новый аккаунт" },
  practice: { badge: "Новая практика", title: "Новая практика" },
};

/**
 * Sent to the team (`TEAM_NOTICE_EMAIL`) when someone signs up or opens a
 * practice. `rows` are plain label/value pairs so the notice stays JSON.
 */
export default function TeamNoticeEmail({
  kind = "user",
  headline = "Анна Иванова",
  rows = [
    { label: "Почта", value: "anna@example.com" },
    { label: "Телефон", value: "+7 900 000-00-00" },
  ],
  link = null,
}: {
  kind: TeamNoticeKind;
  /** Who or what it is: the person's name, the practice's name. */
  headline: string;
  rows: { label: string; value: string }[];
  /** Where to look at it, e.g. the admin site's card. */
  link?: { href: string; label: string } | null;
}) {
  const { badge, title } = COPY[kind];
  return (
    <EmailLayout
      preview={`${title}: ${headline}`}
      footnote={`Служебное письмо ${APP_CONFIG.shortName} для команды.`}
    >
      <EmailHeader
        badge={<EmailBadge tone="info">{badge}</EmailBadge>}
        title={headline}
      />
      {rows.map((row) => (
        <EmailText key={row.label}>
          {row.label}: {row.value}
        </EmailText>
      ))}
      {link ? <EmailButton href={link.href}>{link.label}</EmailButton> : null}
    </EmailLayout>
  );
}
