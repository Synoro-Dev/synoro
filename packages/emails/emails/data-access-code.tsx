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
      preview={`${code} — код для выгрузки данных из ${APP_CONFIG.shortName}`}
      footnote={`Вы получили это письмо, потому что выгрузку данных запросили из вашего аккаунта в ${APP_CONFIG.shortName}. Отвечать на него не нужно.`}
    >
      <EmailHeader
        badge={<EmailBadge>Ваши данные</EmailBadge>}
        title="Подтвердите, что это вы"
        description="Введите этот код на странице выгрузки. Он нужен, чтобы базу клиентов не забрал кто-то другой."
      />
      <EmailCode code={code} caption="Код действует 10 минут" />
      <EmailAlert tone="warning" title="Никому не сообщайте этот код">
        Если вы ничего не выгружали, смените пароль: возможно, кто-то вошёл в
        ваш аккаунт.
      </EmailAlert>
    </EmailLayout>
  );
}
