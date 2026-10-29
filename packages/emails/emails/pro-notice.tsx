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
 * - ending-soon — a paid year ends in two weeks;
 * - ending      — «Про» ends within three days;
 * - ended       — «Про» is over, the practice is on the free plan.
 */
export type ProNotice = "ending-soon" | "ending" | "ended";

/**
 * Sent to a specialist before and after their «Про» (trial or paid period)
 * runs out, with a link to pay for the next period.
 */
export default function ProNoticeEmail({
  notice = "ending",
  name = "Анна",
  paid = false,
  endsOn = "15 ноября 2026",
  left = "через 3 дня",
  prices = "149 ₽ в месяц или 1490 ₽ в год",
  billingUrl = "https://app.synoro.ru/settings/billing",
}: {
  notice: ProNotice;
  name: string;
  /** The period that ends was paid for (not the free trial). */
  paid: boolean;
  /** End of «Про», formatted in Moscow time. */
  endsOn: string;
  /** How soon it ends («через 3 дня»); unused once it ended. */
  left: string;
  prices: string;
  billingUrl: string;
}) {
  const period = paid ? "Оплаченный период «Про»" : "Бесплатный период «Про»";
  const ended = notice === "ended";
  const title = ended ? "«Про» закончился" : `${period} заканчивается`;

  return (
    <EmailLayout
      preview={ended ? `${title} ${endsOn}` : `${title} ${left}`}
      footnote={`Вы получили это письмо, потому что ведёте практику в ${APP_CONFIG.shortName}.`}
    >
      <EmailHeader
        badge={
          <EmailBadge tone={notice === "ending-soon" ? "info" : "warning"}>
            Тариф «Про»
          </EmailBadge>
        }
        title={title}
        description={
          ended
            ? `Здравствуйте, ${name}! ${period} закончился ${endsOn}, практика перешла на бесплатный тариф.`
            : `Здравствуйте, ${name}! «Про» действует до ${endsOn} — это ${left}.`
        }
      />
      {ended ? (
        <EmailText>
          Записи, клиенты и балансы на месте. Клиенты больше не могут оплачивать
          пакеты онлайн на странице записи — чтобы вернуть оплату, продлите
          «Про»: {prices}.
        </EmailText>
      ) : (
        <EmailText>
          Чтобы клиенты и дальше оплачивали пакеты онлайн на странице записи,
          продлите «Про»: {prices}. Автосписаний нет — каждый период
          оплачивается отдельно, новый начнётся после текущего.
        </EmailText>
      )}
      <EmailButton href={billingUrl}>Продлить «Про»</EmailButton>
      {ended ? null : (
        <EmailText muted>
          Если не продлевать, практика перейдёт на бесплатный тариф: записи,
          клиенты и балансы останутся, выключится только оплата онлайн. Свой
          домен и администраторы, которые уже подключены, продолжат работать.
        </EmailText>
      )}
      <EmailLinkFallback href={billingUrl} />
    </EmailLayout>
  );
}
