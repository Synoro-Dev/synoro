/**
 * Telegram and MAX notices («Про», docs/reminders.md): the bots
 * (`./bots`), the messenger text of each mail (`./text`), the action
 * buttons (`./actions`) and picking the channel of a notice (`./deliver`).
 */
export { type MessengerAction, parseAction } from "./actions";
export {
  answerPress,
  botLink,
  type MessengerMessage,
  type MessengerPress,
  messengerConfigured,
  sendToChat,
  webhookSecret,
} from "./bots";
export {
  type Deliver,
  deliverMessenger,
  dispatchNotice,
  noticeSender,
  type Recipient,
} from "./deliver";
export { cancelPrompt } from "./text";
