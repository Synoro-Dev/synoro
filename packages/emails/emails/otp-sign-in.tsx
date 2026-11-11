import { APP_CONFIG } from "@synoro/config";

import { EmailLayout } from "../components/email-layout";
import {
  EmailAlert,
  EmailBadge,
  EmailCode,
  EmailHeader,
} from "../components/email-ui";

export default function OtpSignInEmail({
  otp = "123456",
  isSignUp = false,
}: {
  otp: string;
  isSignUp?: boolean;
}) {
  const actionGenitive = isSignUp ? "подтверждения почты" : "входа";

  return (
    <EmailLayout
      preview={`${otp} — ваш код для ${actionGenitive} в ${APP_CONFIG.shortName}`}
      footnote={`Вы получили это письмо, потому что ваш адрес указали в ${APP_CONFIG.shortName}. Отвечать на него не нужно.`}
    >
      <EmailHeader
        badge={
          <EmailBadge>{isSignUp ? "Подтверждение почты" : "Вход"}</EmailBadge>
        }
        title={
          isSignUp ? "Подтвердите почту" : `Вход в ${APP_CONFIG.shortName}`
        }
        description={`Введите этот код в ${APP_CONFIG.shortName}, чтобы ${
          isSignUp ? "подтвердить адрес почты" : "войти в аккаунт"
        }.`}
      />
      <EmailCode code={otp} caption="Код действует 10 минут" />
      <EmailAlert tone="warning" title="Никому не сообщайте этот код">
        Если вы не запрашивали код, просто проигнорируйте это письмо.
      </EmailAlert>
    </EmailLayout>
  );
}
