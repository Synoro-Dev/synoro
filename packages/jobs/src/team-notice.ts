import { env } from "@synoro/config";
import type { TemplateEmail } from "@synoro/emails";

import { practicePageUrl } from "./urls";

/**
 * Notices for the team (`TEAM_NOTICE_EMAIL`): someone signed up, someone
 * opened a practice. `null` when the address is unset, so callers send
 * nothing. Built here so every place that sends them says the same.
 */

type TeamNotice = Extract<TemplateEmail, { template: "team-notice" }>;

function notice(
  subject: string,
  props: TeamNotice["props"],
): TeamNotice | null {
  const to = env.TEAM_NOTICE_EMAIL;
  if (!to) return null;
  return { template: "team-notice", to: [to], subject, props };
}

export function newUserNotice(user: {
  id: string;
  name: string;
  email: string;
}): TeamNotice | null {
  return notice(`Новый пользователь: ${user.email}`, {
    kind: "user",
    headline: user.name,
    rows: [{ label: "Почта", value: user.email }],
    link: {
      href: `${env.ADMIN_URL}/users/${user.id}`,
      label: "Открыть карточку",
    },
  });
}

export function newPracticeNotice(
  practice: { name: string; slug: string },
  owner: { id: string; name: string; email: string; phone?: string | null },
): TeamNotice | null {
  return notice(`Новая практика: ${practice.name}`, {
    kind: "practice",
    headline: practice.name,
    rows: [
      { label: "Адрес", value: practicePageUrl(practice.slug) },
      { label: "Владелец", value: `${owner.name}, ${owner.email}` },
      ...(owner.phone ? [{ label: "Телефон", value: owner.phone }] : []),
    ],
    link: {
      href: `${env.ADMIN_URL}/users/${owner.id}`,
      label: "Открыть владельца",
    },
  });
}
