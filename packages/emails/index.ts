import type { BookingNotice } from "./emails/booking-notice";
import OtpSignInEmail from "./emails/otp-sign-in";
import type { ProNotice } from "./emails/pro-notice";
import ResetPasswordEmail from "./emails/reset-password";
import WelcomeEmail from "./emails/welcome";

export { sendEmail, sendEmailHtml } from "./send";
export {
  type EmailTemplate,
  sendTemplateEmail,
  type TemplateEmail,
} from "./templates";
export type { BookingNotice, ProNotice };
export { OtpSignInEmail, ResetPasswordEmail, WelcomeEmail };
