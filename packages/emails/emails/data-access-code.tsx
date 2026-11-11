import { APP_CONFIG } from "@synoro/config";

import { EmailLayout } from "../components/email-layout";
import {
  EmailAlert,
  EmailBadge,
  EmailCode,
  EmailHeader,
} from "../components/email-ui";

/** The code that confirms it's the owner who takes the data out. */
export default function DataAccessCodeEmail({
  code = "123456",
}: {
  code: string;
}) {
  return (
    <EmailLayout
      preview={`${code} — код подтверждения в ${APP_CONFIG.shortName}`}
      footnote={`Вы получили это письмо, потому что в вашем аккаунте начали работу с данными клиентов в ${APP_CONFIG.shortName}. Отвечать на него не нужно.`}
    >
      <EmailHeader
        badge={<EmailBadge>Ваши данные</EmailBadge>}
        title="Подтвердите, что это вы"
        description="Введите этот код на странице, где вы работаете с данными. Он нужен, чтобы базой клиентов не воспользовался кто-то другой."
      />
      <EmailCode code={code} caption="Код действует 10 минут" />
      <EmailAlert tone="warning" title="Никому не сообщайте этот код">
        Если это были не вы, смените пароль: возможно, кто-то вошёл в ваш
        аккаунт.
      </EmailAlert>
    </EmailLayout>
  );
}
