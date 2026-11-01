/**
 * Messengers the Synoro bots write in («Про»): reminders and booking notices
 * go there instead of mail once the user links one. Keep in sync with the
 * `messenger` enum in `@synoro/db`.
 */
export const MESSENGERS = ["telegram", "max"] as const;

export type Messenger = (typeof MESSENGERS)[number];

export const MESSENGER_LABELS: Record<Messenger, string> = {
  telegram: "Telegram",
  max: "MAX",
};
