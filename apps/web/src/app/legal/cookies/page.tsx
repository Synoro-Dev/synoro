import { legal } from "@synoro/config";
import type { Metadata } from "next";
import { CookieChoice } from "~/components/cookie-choice";
import {
  Clause,
  DataTable,
  LegalPage,
  Link,
  Part,
} from "~/components/legal/document";
import { env } from "~/env";

const doc = legal.docs.cookies;
const { operator } = legal;
const counterId = env.NEXT_PUBLIC_YANDEX_METRIKA_ID;

export const metadata: Metadata = {
  title: doc.short,
  description: doc.description,
  alternates: { canonical: doc.path },
};

export default function CookiesPage() {
  return (
    <LegalPage
      title={doc.title}
      updatedAt={legal.updatedAt}
      lead={
        <p>
          Cookie — небольшие файлы, которые сайт сохраняет в вашем браузере.
          Ниже — какие мы используем и зачем.
        </p>
      }
    >
      <Part id="what" n={1} title="Что мы используем">
        <DataTable
          head={["Что", "Зачем", "Срок"]}
          rows={[
            [
              "Сессионные cookie входа (по умолчанию с префиксом better-auth)",
              "Узнают вас после входа в кабинет. Без них личный кабинет не работает. Обязательные.",
              "до выхода или окончания сессии",
            ],
            [
              "Локальное хранилище браузера",
              "Запоминает выбранную тему оформления. Обязательное для удобства, данные не передаются.",
              "пока вы не очистите данные сайта",
            ],
            [
              "Яндекс Метрика (_ym_*)",
              "Статистика посещаемости и оценка рекламы на сайте synoro.ru и в личном кабинете app.synoro.ru. Включена по умолчанию, пока вы не откажетесь; данные о действиях на странице (включая Вебвизор) обрабатывает Яндекс.",
              "до 1 года",
            ],
            [
              "cookie_consent",
              "Запоминает ваш выбор по аналитике, чтобы не показывать уведомление повторно и не включать счётчик после отказа. Обязательная.",
              "1 год",
            ],
          ]}
        />
        <Clause n="1.1.">
          Cookie авторизации мы устанавливаем на основании договора и для
          безопасности. Аналитика включена по умолчанию, пока вы не откажетесь
          от неё в уведомлении внизу страницы или ниже, в разделе 2.
        </Clause>
      </Part>

      <Part id="control" n={2} title="Как отключить">
        {counterId && (
          <>
            <Clause n="2.1.">
              Откажитесь от аналитики или включите её снова — выбор действует на
              synoro.ru и app.synoro.ru, пока вы не удалите cookie браузера:
            </Clause>
            <CookieChoice counterId={counterId} />
          </>
        )}
        <Clause n="2.2.">
          Cookie можно удалить или запретить в настройках браузера; без cookie
          входа вы не сможете войти в кабинет.
        </Clause>
        <Clause n="2.3.">
          Отключить сбор данных Яндекс Метрикой можно по инструкции Яндекса:{" "}
          <Link href="https://yandex.ru/support/metrica/general/opt-out.html">
            yandex.ru/support/metrica/general/opt-out.html
          </Link>
          .
        </Clause>
        <Clause n="2.4.">
          Как мы обрабатываем персональные данные, описано в{" "}
          <Link href={legal.docs.privacy.path}>
            политике конфиденциальности
          </Link>
          . Вопросы — на{" "}
          <Link href={`mailto:${operator.email}`}>{operator.email}</Link>.
        </Clause>
      </Part>
    </LegalPage>
  );
}
