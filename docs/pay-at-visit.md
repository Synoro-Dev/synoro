# Payment at the visit

For specialists who are paid in person — a private doctor, an osteopath — and
want Synoro only as the booking calendar: clients book any service on the
booking page, nothing is paid online, the contract and the money happen at
the visit.

## The switch (`practices.pay_at_visit`)

The owner turns it on in «Настройки → Страница записи» («Оплата на приёме»,
`practice.setPayAtVisit`). Free plan. While it is on:

- the booking page books every service with `booking.bookAtVisit` — visitors
  without an account, signed-in clients without a balance;
- online payment is closed: `payment.packages` says `enabled: false`,
  `booking.reserve` and `payment.checkout` answer `PAYMENTS_DISABLED`;
- a client's own `booking.book` / `bookSeries` answer `PAY_AT_VISIT`;
- staff book clients (`book`, `bookSeries` with `memberId`) without the
  balance: `credits` 0, no `credit_entries`, no `NO_CREDITS`.

Balances, packages and bookings made before stay as they are; turning it off
brings the balance back into play for new bookings only.

## A booking paid at the visit

It is an ordinary `kind = 'consultation'` booking with its `service_id` and
**`credits = 0`**: length, calendar, reminders, moving, no-shows, the waiting
list and analytics treat it like any other. Every booking that took credits
has `credits ≥ 1` (services cost 1–10, migration `0018` gave older ones 1), so
`credits = 0` means «nothing to give back» everywhere:

- **Cancel and move**: a client may do it until it starts, like a free intro
  (`clientMayCancel` in `@synoro/validators`); nothing is refunded.
- **`/b/<token>`** (`booking.guest`) says `charged: false`, and a cancelled one
  is `cancelled`, never `expired` (that is for unpaid holds).
- **Cabinet** (`booking.mine`) has `charged` too; mails, messenger notices and
  the staff calendar leave out every line about the balance (`free` /
  `charged` props of `booking-notice` and `staff-booking`).

Calendar imports also write `consultation` with `credits = 0`, but without a
client, so the cancel rule never reaches them.

## `booking.bookAtVisit` (public)

The flow of `bookIntro` (`docs/free-booking.md`) for a service:

1. `RATE_LIMITED` past 10 requests in ten minutes from one address
   (`clientIp`); `PAY_AT_VISIT_OFF` without the switch; `SERVICE_NOT_FOUND`;
   the questionnaire («Про»), the schedule on the service's grid and Google
   busy time.
2. Who books: a signed-in client as themselves (phone required, joins the
   practice; staff get `STAFF`), else the visitor's name, phone and email
   (`findOrCreateGuestMember`; a staff email is `SIGN_IN_REQUIRED`).
3. `RATE_LIMITED` past 3 booking mails an hour to one email.
4. Under an advisory lock per practice: `TOO_MANY` when the member, or anyone
   with the same phone, already has `AT_VISIT_MAX_UPCOMING` (3) upcoming
   active bookings paid at the visit here. Then the insert, confirmed at once
   (`hold_until` null), with `access_token_hash`.
5. Google export; staff are told (`notifyBookingConfirmed(…, { client: false })`
   — the client's mail is the link); `booking-link` with `atVisit`; the
   reminders already due are marked sent once that mail went out.

Nothing is paid, so typed contacts are the only brake: the limits above, not
a proven email. If fake bookings show up, the next step is to wait for the
emailed link before the time is taken, as `waitlist.confirm` does — a hold
that does not mean «awaiting payment», which `hold_until` does today.

## Not done

- No price shown: services keep their price in credits, which the page hides
  in this mode. A plain «Стоимость» field is a separate task.
- No SMS: reminders go by mail, or a messenger on «Про».
- The landing (`apps/web/src/lib/professions.ts`, FAQ) does not mention it yet.
