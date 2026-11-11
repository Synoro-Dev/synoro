/**
 * What the action buttons under messenger notices ask for, written into the
 * button (Telegram `callback_data` takes at most 64 bytes) and read back by
 * the webhook. Nothing in the string is trusted: the webhook checks the
 * chat's user against the booking.
 */
export type MessengerAction =
  /** «Отменить запись»: ask «Точно?» first. */
  | { kind: "cancel"; bookingId: string }
  /** «Да, отменить» under that question. */
  | { kind: "cancel-confirmed"; bookingId: string }
  /** «Нет, оставить». */
  | { kind: "keep" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The button's string for `action`. */
export function actionData(action: MessengerAction) {
  switch (action.kind) {
    case "cancel":
      return `cancel:${action.bookingId}`;
    case "cancel-confirmed":
      return `cancel!:${action.bookingId}`;
    case "keep":
      return "keep";
  }
}

/** The action a pressed button carries, or null for anything else. */
export function parseAction(data: string): MessengerAction | null {
  if (data === "keep") return { kind: "keep" };
  const match = /^(cancel!?):(.+)$/.exec(data);
  if (!match?.[2] || !UUID.test(match[2])) return null;
  return {
    kind: match[1] === "cancel!" ? "cancel-confirmed" : "cancel",
    bookingId: match[2],
  };
}
