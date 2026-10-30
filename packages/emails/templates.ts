import BookingLinkEmail from "./emails/booking-link";
import BookingNoticeEmail from "./emails/booking-notice";
import OtpSignInEmail from "./emails/otp-sign-in";
import ProNoticeEmail from "./emails/pro-notice";
import ResetPasswordEmail from "./emails/reset-password";
import StaffBookingEmail from "./emails/staff-booking";
import WelcomeEmail from "./emails/welcome";
import WorkflowMessageEmail from "./emails/workflow-message";
import { sendEmail } from "./send";

const templates = {
  "booking-link": BookingLinkEmail,
  "booking-notice": BookingNoticeEmail,
  "otp-sign-in": OtpSignInEmail,
  "pro-notice": ProNoticeEmail,
  "reset-password": ResetPasswordEmail,
  "staff-booking": StaffBookingEmail,
  welcome: WelcomeEmail,
  "workflow-message": WorkflowMessageEmail,
};

export type EmailTemplate = keyof typeof templates;

/**
 * A template email as plain JSON: template name + props instead of a React
 * element, so it can cross a process boundary (a Hatchet task input) and be
 * rendered by whoever sends it.
 */
export type TemplateEmail = {
  [T in EmailTemplate]: {
    template: T;
    to: string[];
    subject: string;
    props: Parameters<(typeof templates)[T]>[0];
  };
}[EmailTemplate];

/** Renders `message.template` with its props and sends it. */
export function sendTemplateEmail(message: TemplateEmail) {
  const { template, to, subject, props } = message;
  // The union guarantees `props` matches `template`; TS can't correlate the
  // two through the lookup, hence the widened component type.
  const Template = templates[template] as (props: unknown) => React.ReactNode;

  return sendEmail({ to, subject, react: Template(props) });
}
