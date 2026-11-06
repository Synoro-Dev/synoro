import { APP_CONFIG } from "@synoro/config";

import { EmailLayout } from "../components/email-layout";
import {
  EmailBadge,
  EmailButton,
  EmailHeader,
  EmailLinkFallback,
  EmailText,
} from "../components/email-ui";

/**
 * Sent to the address a practice invited: they accept it under «Практики»
 * after signing in (or signing up) with this very email.
 */
export default function PracticeInvitationEmail({
  practiceName = "Анна Иванова",
  inviterName = "Анна",
  role = "client",
  acceptUrl = "https://app.synoro.ru/practices",
}: {
  practiceName: string;
  inviterName: string;
  role: "admin" | "client";
  acceptUrl: string;
}) {
  const admin = role === "admin";
  return (
    <EmailLayout
      preview={`Приглашение в практику «${practiceName}»`}
      footnote={`Вы получили это письмо, потому что ${inviterName} указал(а) ваш адрес в ${APP_CONFIG.shortName}. Если приглашение вам не нужно, просто проигнорируйте письмо.`}
    >
      <EmailHeader
        badge={<EmailBadge tone="info">Приглашение</EmailBadge>}
        title={`Практика «${practiceName}»`}
        description={
          admin
            ? `${inviterName} приглашает вас администратором практики «${practiceName}».`
            : `${inviterName} приглашает вас клиентом практики «${practiceName}».`
        }
      />
      <EmailText>
        Войдите или зарегистрируйтесь с этой почтой и примите приглашение в
        разделе «Практики». Оно действует 7 дней.
      </EmailText>
      <EmailButton href={acceptUrl}>Принять приглашение</EmailButton>
      <EmailLinkFallback href={acceptUrl} />
    </EmailLayout>
  );
}
