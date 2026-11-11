import { APP_CONFIG, env } from "@synoro/config";

import { EmailLayout } from "../components/email-layout";
import {
  EmailBadge,
  EmailButton,
  EmailHeader,
  EmailLinkFallback,
  EmailSteps,
} from "../components/email-ui";

export default function WelcomeEmail({
  username = "username",
}: {
  username: string;
}) {
  return (
    <EmailLayout
      preview={`Добро пожаловать в ${APP_CONFIG.shortName} — с чего начать`}
      footnote={`Вы получили это письмо, потому что создали аккаунт в ${APP_CONFIG.shortName}. Если это были не вы, свяжитесь со службой поддержки.`}
    >
      <EmailHeader
        badge={<EmailBadge tone="success">Аккаунт создан</EmailBadge>}
        title={`Добро пожаловать, ${username}!`}
        description={`Рады видеть вас в ${APP_CONFIG.shortName}. Всё готово — вот три шага, чтобы начать принимать записи.`}
      />
      <EmailSteps
        steps={[
          {
            title: "Создайте практику",
            description: "Рабочее пространство для клиентов и записей.",
          },
          {
            title: "Настройте расписание",
            description: "Укажите дни и часы, когда вы принимаете.",
          },
          {
            title: "Поделитесь страницей записи",
            description: "Клиенты выберут время сами — без переписки.",
          },
        ]}
      />
      <EmailButton href={env.APP_URL}>Начать работу</EmailButton>
      <EmailLinkFallback href={env.APP_URL} />
    </EmailLayout>
  );
}
