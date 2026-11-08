# Формат `data.json`

Полный машиночитаемый дамп аккаунта в архиве экспорта (`docs/data-export.md`).
Собирает его `collectAccount` в `packages/jobs/src/data-export/collect.ts`.

Правило версий: **`format_version`** растёт, когда поле меняет смысл или
исчезает. Новые необязательные поля версию не меняют. Импорт обязан читать все
прошлые версии: архивы должны загружаться и через год.

## Верхний уровень

| Поле                    | Что это                                                   |
| ----------------------- | --------------------------------------------------------- |
| `format_version`        | Номер версии формата, сейчас `1`                          |
| `exported_at`           | Момент выгрузки, ISO 8601 в UTC                           |
| `account`               | `name`, `email`, `phone`, `username`, `bio`, `created_at` |
| `subscription`          | `trial_ends_at`, `paid_until` или `null`                  |
| `subscription_payments` | Оплаты «Про»                                              |
| `slug_orders`           | Покупки коротких адресов                                  |
| `practices`             | Практики, которыми владеет аккаунт                        |

Все моменты времени — ISO 8601 в UTC. Деньги — в копейках, поля `*_kopecks`.

## Практика

Настройки: `id`, `name`, `slug`, `old_slugs`, `domains`, `timezone`, `profession`,
`video_url`, `client_contact`, `booking_questions`, `booking_theme`,
`free_booking_enabled`, `intro_minutes`, `pay_at_visit`, `remind_clients`, `notify_staff`,
`daily_agenda`, `created_at`, `working_hours`, `packages`, `messages`,
`payment_accounts` (без ключей и идентификатора магазина).

Часы работы, `working_hours`: `weekday` (1 — понедельник, 7 — воскресенье),
`start_minute`, `end_minute` в минутах от полуночи по времени практики.

Закрытые даты отдельно не хранятся: это записи с `kind = "blocked"`.

### Люди

- `team` — владелец и администраторы: `id`, `role`, `name`, `email`, `phone`,
  `credits`, `created_at`.
- `clients` — клиенты с кабинетом: те же поля без `role`.
- `imported_clients` — карточки клиентов, перенесённых из таблиц и других
  сервисов: `id`, `name`, `phone`, `email`, `note`, `credits`, `created_at`.

Гости, которых записывали по имени и телефону, отдельным списком не идут: они
живут в полях записи (`guest_name`, `guest_phone`, `guest_contact`).

### Записи

`bookings`: `id`, `kind` (`consultation`, `free`, `blocked`), `status` (`active`,
`cancelled`), `starts_at`, `ends_at`, `client_id` (→ `clients.id` или `team.id`),
`guest_name`, `guest_phone`, `guest_contact`, `note`, `client_timezone`, `answers`
(`[{ question, answer }]`, с формулировкой вопроса на момент записи),
`series_id` (→ `series.id`), `meeting_url`, `hold_until`, `cancel_reason`,
`cancelled_at`, `created_at`.

`series`: `id`, `client_id`, `interval_weeks`, `count`, `cancelled_at`,
`created_at`.

`notes` (рабочие заметки владельца, в открытом виде): `id`, `client_id`
(→ `clients.id`), `booking_id` (→ `bookings.id`, если заметка к сессии), `text`,
`created_at`, `updated_at`.

### Деньги

`credit_entries` (журнал баланса): `id`, `client_id`, `delta`, `reason` (`purchase`,
`booking`, `refund`, `adjustment`), `booking_id`, `payment_id`, `note`, `created_at`.

`payments` (онлайн-оплаты клиентов): `id`, `client_id`, `booking_id`, `provider`,
`external_id`, `status`, `credits`, `amount_kopecks`, `paid_at`, `created_at`.

## Чего в файле нет намеренно

Ключи ЮKassa и Т-Банка, токены Google, чаты мессенджеров, сессии, хэши паролей и
ссылок на записи, сведения о входах.
