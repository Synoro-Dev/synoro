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
`free_booking_enabled`, `intro_minutes`, `pay_at_visit`, `accepts_minors`, `cancel_hours` (срок
отмены в часах), `late_cancel` (поздняя отмена без возврата), `remind_clients`, `notify_staff`,
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
`series_id` (→ `series.id`), `meeting_url`, `hold_until`, `cancel_reason`
(`client`, `late_cancel`, `staff`, `no_show`, `hold_expired`, `payment_cancelled`),
`cancelled_at`, `created_at`.

`series`: `id`, `client_id`, `interval_weeks`, `count`, `cancelled_at`,
`created_at`.

`notes` (рабочие заметки владельца, в открытом виде): `id`, `client_id`
(→ `clients.id`), `booking_id` (→ `bookings.id`, если заметка к сессии), `text`
(`null`, если заметку не удалось расшифровать — например, сменили ключ),
`created_at`, `updated_at`.

### Документы и согласия

`documents`: `id`, `kind` (`offer`, `informed_consent`, `personal_data`, `other`),
`required`, `archived`, `versions` — все редакции по порядку: `id`, `number`, `title`,
`text`, `created_at`. Действует редакция с наибольшим `number`.

`consents` (кто какую редакцию принял): `id`, `client_id`, `booking_id`, `version_id`
(→ `documents[].versions[].id`), `document_title`, `document_version`, `accepted_at`,
`ip`, `user_agent`, `representative_name` и `minor_name` (если согласие дал родитель
за ребёнка). Перенесённые из прошлого архива идут первыми; их `version_id` относится
к прежней практике, поэтому название и номер редакции записаны в самой строке.

### Деньги

`credit_entries` (журнал баланса): `id`, `client_id`, `delta`, `reason` (`purchase`,
`booking`, `refund`, `adjustment`), `booking_id`, `payment_id`, `note`, `created_at`.

`payments` (онлайн-оплаты клиентов): `id`, `client_id`, `booking_id`, `provider`,
`external_id`, `status`, `credits`, `amount_kopecks`, `paid_at`, `created_at`.

`offline_payments` (оплаты вне Synoro, записанные сотрудниками): `id`, `client_id`,
`booking_id` (запись, оплаченная на приёме), `credit_entry_id` (→ `credit_entries.id`,
если это пакет), `credits` (сколько занятий начислено вместе с ней, или `null`),
`amount_kopecks`, `method` (`cash`, `transfer`, `card`, `other`), `paid_at`, `note`,
`created_at`. Перенесённые из прошлого архива идут первыми, в том же виде.

## Чего в файле нет намеренно

Ключи ЮKassa и Т-Банка, токены Google, чаты мессенджеров, сессии, хэши паролей и
ссылок на записи, сведения о входах.
