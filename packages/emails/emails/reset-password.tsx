import { env } from "@synoro/config";

import { EmailLayout } from "../components/email-layout";
import {
  EmailAlert,
  EmailBadge,
  EmailButton,
  EmailHeader,
  EmailLinkFallback,
  EmailText,
} from "../components/email-ui";

export default function ResetPasswordEmail({
  resetLink = `${env.APP_URL}/auth/reset-password?token=abc123`,
}: {
  resetLink?: string;
}) {
  return (
    <EmailLayout preview="Ссылка для сброса пароля — действует 1 час">
      <EmailHeader
        badge={<EmailBadge>Безопасность</EmailBadge>}
        title="Сброс пароля"
        description="Мы получили запрос на смену пароля для вашего аккаунта. Нажмите кнопку ниже, чтобы задать новый."
      />
      <EmailButton href={resetLink}>Задать новый пароль</EmailButton>
      <EmailText muted>
        В целях безопасности ссылка действительна в течение 1 часа.
      </EmailText>
      <EmailAlert tone="info" title="Не запрашивали сброс?">
        Проигнорируйте это письмо — пароль останется прежним. Если такие письма
        приходят снова, свяжитесь со службой поддержки.
      </EmailAlert>
      <EmailLinkFallback href={resetLink} />
    </EmailLayout>
  );
}
