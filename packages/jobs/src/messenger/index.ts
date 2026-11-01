/**
 * Telegram and MAX notices («Про», docs/reminders.md): the bots
 * (`./bots`), the messenger text of each mail (`./text`) and picking the
 * channel of a notice (`./deliver`).
 */
export {
  botLink,
  type MessengerMessage,
  messengerConfigured,
  sendToChat,
  webhookSecret,
} from "./bots";
export {
  type Deliver,
  dispatchNotice,
  noticeSender,
  type Recipient,
} from "./deliver";
