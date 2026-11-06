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
 * The archive is ready. The mail never carries the data: the link leads to the
 * settings, which need a sign-in.
 */
export default function DataExportReadyEmail({
  kind = "full",
  expiresOn = "15 ноября",
  url = "https://app.synoro.ru/settings/data",
}: {
  /** full — asked for with the button; weekly — the weekly copy of clients. */
  kind: "full" | "weekly";
  /** Until when the archive can be downloaded. */
  expiresOn: string;
  url: string;
}) {
  const weekly = kind === "weekly";
  const title = weekly
    ? "Копия базы клиентов готова"
    : "Архив с вашими данными готов";

  return (
    <EmailLayout
      preview={`${title}. Скачать можно до ${expiresOn}`}
      footnote={
        weekly
          ? `Вы получаете это письмо раз в неделю, потому что включили копию базы клиентов в ${APP_CONFIG.shortName}. Отключить её можно там же, в настройках.`
          : `Вы получили это письмо, потому что запросили выгрузку данных в ${APP_CONFIG.shortName}.`
      }
    >
      <EmailHeader
        badge={<EmailBadge tone="success">Ваши данные</EmailBadge>}
        title={title}
        description={`Скачать архив можно до ${expiresOn}. Для этого нужно войти в аккаунт: так данные не попадут к другому человеку, даже если письмо перешлют.`}
      />
      <EmailButton href={url}>Открыть страницу с архивом</EmailButton>
      <EmailLinkFallback href={url} />
      <EmailText>
        В архиве есть данные ваших клиентов. Храните его там, куда нет доступа у
        других людей.
      </EmailText>
    </EmailLayout>
  );
}
