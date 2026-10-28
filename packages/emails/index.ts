import type { BookingNotice } from "./emails/booking-notice";
import OtpSignInEmail from "./emails/otp-sign-in";
import ResetPasswordEmail from "./emails/reset-password";
import WelcomeEmail from "./emails/welcome";

export { sendEmail, sendEmailHtml } from "./send";
export {
  type EmailTemplate,
  sendTemplateEmail,
  type TemplateEmail,
} from "./templates";
export type { BookingNotice };
export { OtpSignInEmail, ResetPasswordEmail, WelcomeEmail };
