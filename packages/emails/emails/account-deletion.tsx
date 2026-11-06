import { APP_CONFIG } from "@synoro/config";

import { EmailLayout } from "../components/email-layout";
import {
  EmailAlert,
  EmailBadge,
  EmailButton,
  EmailHeader,
  EmailLinkFallback,
  EmailText,
} from "../components/email-ui";

/** The owner asked to delete their account: the date, and how to change their mind. */
export default function AccountDeletionEmail({
  purgeOn = "6 декабря 2026",
  url = "https://app.synoro.ru/settings/data",
}: {
  /** When everything is deleted for good. */
  purgeOn: string;
  url: string;
}) {
  return (
    <EmailLayout
      preview={`Аккаунт будет удалён ${purgeOn}. До этого его можно восстановить`}
      footnote={`Вы получили это письмо, потому что из вашего аккаунта в ${APP_CONFIG.shortName} запросили удаление.`}
    >
      <EmailHeader
        badge={<EmailBadge tone="warning">Удаление аккаунта</EmailBadge>}
        title="Аккаунт будет удалён"
        description={`${purgeOn} мы безвозвратно удалим аккаунт, практики, клиентов и записи. Страница записи уже закрыта.`}
      />
      <EmailButton href={url}>Восстановить или скачать данные</EmailButton>
      <EmailLinkFallback href={url} />
      <EmailText>
        До этой даты аккаунт можно восстановить в один клик, и архив с данными
        тоже можно скачать.
      </EmailText>
      <EmailAlert tone="warning" title="Вы этого не делали?">
        Войдите в аккаунт, восстановите его и смените пароль.
      </EmailAlert>
    </EmailLayout>
  );
}
