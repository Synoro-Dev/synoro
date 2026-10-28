# Биллинг «Про» через Точка Банк

Специалист платит Synoro за тариф «Про»: **149 ₽ за месяц** или **1490 ₽ за
год**, первые **14 дней** бесплатно. Деньги идут на расчётный счёт платформы
через интернет-эквайринг Точки — это не путь, которым клиенты платят
специалисту (тот идёт на его собственную ЮKassa / Т-Банк, `docs/guest-booking.md`).

## Как работает

- **Пробный период.** `practice.create` вызывает `ensureSubscription`: строка
  `subscriptions` с `trial_ends_at = now() + 14 days`, один раз на
  пользователя. У тех, кто создал практику до запуска биллинга, пробный
  период — до 1 января 2027 (миграция `0004_billing`, обещано в Условиях).
- **«Про» включён**, пока `now()` раньше `trial_ends_at` или `paid_until`
  (`planOf` / `hasPro` в `packages/api/src/lib/billing`). Потом — бесплатный
  тариф, данные остаются.
- **Оплата.** «Настройки → Тариф» (`/settings/billing`) → `billing.checkout
  { period }` создаёт `subscription_payments` (pending) и платёжную ссылку
  Точки (`POST /acquiring/v1.0/payments` или `payments_with_receipt`, карта +
  СБП, ссылка живёт сутки). Специалист возвращается на `/settings/billing?payment=<id>`,
  страница опрашивает `billing.status`.
- **Зачисление.** Банк — источник правды: `billing.status` и вебхук
  перечитывают операцию `GET /acquiring/v1.0/payments/{operationId}`.
  `APPROVED` с совпадающей суммой → `succeeded` и продление `paid_until` одним
  SQL-выражением с блокировкой строк (`settleSubscriptionPayment`): период
  начинается с конца текущего (пробного или оплаченного), а если «Про» уже
  закончился — с текущего момента. `EXPIRED` → `canceled`.
- **Без автосписаний.** Продление — новой оплатой. Рекуррентные платежи Точки
  (`/acquiring/v1.0/subscriptions`) пока не используем: для них нужно
  отдельное согласие в Условиях.

Закрыто на бесплатном тарифе: подключение ЮKassa / Т-Банка
(`payment.connect`), оплата пакетов клиентами (`payableAccount`: страница
записи прячет оплату, `checkout` / `reserve` отвечают `PAYMENTS_DISABLED`),
подключение своего домена (`domain.connect`) и приглашение администраторов
(`practice.addMember` с ролью admin). Уже подключённые домен и
администраторы продолжают работать.

## Настройка

1. Интернет-эквайринг в Точке подключён, торговая точка в статусе `REG`.
   Для чеков 54-ФЗ — онлайн-касса Точки.
2. Интернет-банк → Сервисы → Интеграции и API → **Создать JWT-ключ** с
   правами `MakeAcquiringOperation`, `ReadAcquiringData`, `ReadCustomerData`
   и `ManageWebhookData`. Сохраните `client_id` рядом с ключом.
3. `customerCode` — из `GET /uapi/open-banking/v1.0/customers` (объект с
   `customerType: "Business"`); `merchantId` (если торговых точек несколько) —
   из `GET /uapi/acquiring/v1.0/retailers?customerCode=…`.
4. Env (`packages/config/src/env.ts`):

   ```bash
   TOCHKA_API_TOKEN=<JWT>
   TOCHKA_CUSTOMER_CODE=<customerCode>
   TOCHKA_MERCHANT_ID=<merchantId>     # если торговых точек несколько
   TOCHKA_TAX_SYSTEM=usn_income        # с чеком; без переменной — без чека
   # TOCHKA_API_URL=https://enter.tochka.com/sandbox/v2  # песочница
   ```

5. Вебхук (один раз на ключ). Точка шлёт тестовое уведомление и не создаёт
   вебхук, если адрес не ответил 200 — деплой с маршрутом должен быть уже
   доступен по HTTPS:

   ```bash
   curl -X PUT "https://enter.tochka.com/uapi/webhook/v1.0/<client_id>" \
     -H "Authorization: Bearer $TOCHKA_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"webhooksList":["acquiringInternetPayment"],"url":"https://app.synoro.ru/api/billing/tochka"}'
   ```

   Тело вебхука — JWT (RS256). Подпись не проверяем: из него берём только
   `operationId` и перечитываем операцию по API своим ключом. Пока банк не
   подтвердил оплату, маршрут отвечает 503, и Точка повторяет (до 30 раз).
   Без вебхука оплата зачислится, когда специалист вернётся на страницу.

Без `TOCHKA_API_TOKEN` / `TOCHKA_CUSTOMER_CODE` пробный период работает, а
кнопки оплаты выключены. На демо-стенде (`DEMO_LOGIN_EMAIL` без Точки)
оплата «Про» проходит мгновенно, как платежи `demo-` магазинов.

## Что ещё не сделано

- Письма об окончании пробного и оплаченного периода (нужна плановая задача
  в `packages/jobs`). Для ранних пользователей — не позже 17 декабря 2026.
- Возвраты — вручную в интернет-банке Точки; `paid_until` после возврата
  поправить в базе.
