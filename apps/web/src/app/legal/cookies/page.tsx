import { legal } from "@synoro/config";
import type { Metadata } from "next";

import {
  Clause,
  DataTable,
  LegalPage,
  Link,
  Part,
} from "~/components/legal/document";

const doc = legal.docs.cookies;
const { operator } = legal;

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
              "Статистика посещаемости и оценка рекламы на сайте synoro.ru. Включена не всегда; данные о действиях на странице (включая Вебвизор) обрабатывает Яндекс.",
              "до 1 года",
            ],
          ]}
        />
        <Clause n="1.1.">
          Cookie авторизации мы устанавливаем на основании договора и для
          безопасности. Аналитические — только на сайте synoro.ru и только если
          счётчик включён.
        </Clause>
      </Part>

      <Part id="control" n={2} title="Как отключить">
        <Clause n="2.1.">
          Cookie можно удалить или запретить в настройках браузера; без cookie
          входа вы не сможете войти в кабинет.
        </Clause>
        <Clause n="2.2.">
          Отключить сбор данных Яндекс Метрикой можно по инструкции Яндекса:{" "}
          <Link href="https://yandex.ru/support/metrica/general/opt-out.html">
            yandex.ru/support/metrica/general/opt-out.html
          </Link>
          .
        </Clause>
        <Clause n="2.3.">
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
