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
 * What the email is about:
 * - charged  — the card was charged for the next period;
 * - failed   — the bank declined the charge, another attempt follows;
 * - canceled — the last attempt failed, auto-renewal is switched off.
 */
export type RenewalNotice = "charged" | "failed" | "canceled";

/**
 * Sent to a specialist about the automatic renewal of their «Про»: the
 * charge, a failed one, and the end of auto-renewal after repeated failures.
 */
export default function RenewalNoticeEmail({
  notice = "charged",
  name = "Анна",
  amount = "149 ₽",
  period = "месяц",
  until = "15 декабря 2026",
  endsOn = "15 ноября 2026",
  billingUrl = "https://app.synoro.ru/settings/billing",
}: {
  notice: RenewalNotice;
  name: string;
  /** What was (or could not be) charged, «149 ₽». */
  amount: string;
  /** «месяц» or «год». */
  period: string;
  /** End of «Про» after a successful charge. */
  until: string;
  /** End of the paid period that was to be renewed. */
  endsOn: string;
  billingUrl: string;
}) {
  const titles: Record<RenewalNotice, string> = {
    charged: "«Про» продлён",
    failed: "Не удалось продлить «Про»",
    canceled: "Автопродление «Про» отключено",
  };
  const title = titles[notice];

  return (
    <EmailLayout
      preview={title}
      footnote={`Вы получили это письмо, потому что подключили автопродление «Про» в ${APP_CONFIG.shortName}.`}
    >
      <EmailHeader
        badge={
          <EmailBadge tone={notice === "charged" ? "success" : "warning"}>
            Тариф «Про»
          </EmailBadge>
        }
        title={title}
        description={
          notice === "charged"
            ? `Здравствуйте, ${name}! С вашей карты списано ${amount} за ${period} «Про». Тариф действует до ${until}.`
            : `Здравствуйте, ${name}! Банк не провёл списание ${amount} за ${period} «Про». Оплаченный период заканчивается ${endsOn}.`
        }
      />
      {notice === "charged" && (
        <EmailText>
          Чек придёт отдельным письмом. Отключить автопродление можно в любой
          момент на странице тарифа — уже оплаченный период сохранится.
        </EmailText>
      )}
      {notice === "failed" && (
        <EmailText>
          Мы попробуем списать ещё раз в ближайшие дни. Проверьте, что на карте
          хватает денег и она не заблокирована; или оплатите «Про» вручную —
          тогда повторных списаний не будет, пока не подойдёт следующий период.
        </EmailText>
      )}
      {notice === "canceled" && (
        <EmailText>
          Попытки списать оплату не удались, поэтому деньги больше не
          списываются автоматически. Чтобы «Про» работал дальше, оплатите его на
          странице тарифа; автопродление можно подключить заново.
        </EmailText>
      )}
      {notice !== "charged" && (
        <EmailButton href={billingUrl}>Оплатить «Про»</EmailButton>
      )}
      {notice === "charged" && (
        <EmailButton href={billingUrl}>Тариф «Про»</EmailButton>
      )}
      <EmailLinkFallback href={billingUrl} />
    </EmailLayout>
  );
}
