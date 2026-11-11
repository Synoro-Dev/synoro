# Demo stand

`demo.synoro.ru` (and `bun db:seed` locally) shows one psychologist's practice
from every side, with two months of believable history around today's date.
Nobody signs in: `DEMO_LOGIN_EMAIL` makes `/auth/demo` open a session, and the
sidebar's **«Демо: войти как»** switches the role (`/auth/demo?as=<key>`).

| Key            | Account (`@example.com`)   | What to look at                                             |
| -------------- | -------------------------- | ----------------------------------------------------------- |
| `owner`        | klyuev — Андрей Клюев      | Overview, calendar, clients, payments setup, incoming money |
| `admin`        | admin.klyuev — Мария       | Same cabinet, but no payment account; credits, free slots   |
| `client`       | olga.petrova — Ольга       | 3 consultations on the balance, bookings, payment history   |
| `client-empty` | alexey.kuznetsov — Алексей | Balance 0, an unfinished payment waiting, a declined one    |
| `client-new`   | sergey.novikov — Сергей    | Joined a week ago: first purchase, first booking            |

The roster lives in `packages/auth/src/demo-accounts.ts`; `demoLogin` signs in
only to these (or `DEMO_LOGIN_EMAIL`), never to a real or admin account.

## What is seeded (`packages/auth/script/seed.ts`)

- **People**: owner, administrator, ten clients (regulars, a newcomer, one who
  never booked, one with a big package), two visitors without an account.
- **Calendar**: six weeks back, three ahead; weekly supervision / personal-therapy
  blocks, free 30-minute consultations for guests, cancellations, a few
  no-shows (cancelled with `cancel_reason = 'no_show'`, nothing refunded). Deterministic
  per day, never overlapping, always inside the schedule.
- **Money**: packages 1 × 3 500 ₽, 5 × 16 000 ₽, 10 × 30 000 ₽. The first
  weeks were paid by hand (transfer, cash — `credit_entries` without a
  payment); then ЮKassa; three weeks ago the practice switched to Т-Банк, so
  the payments list shows both providers and the settings show one live
  account. Payments are paid, pending (one fresh and resumable, one stale) or
  declined. Every balance equals the sum of its history.
- **Visitors**: `/b/demo-guest-paid-booking-0001` is a booking paid online
  without an account (a 5-pack: booked one hour, 4 left);
  `/b/demo-guest-expired-hold-0002` left the payment page and lost the held time.
- **Invitations**: two pending client invitations.

## Paying in the demo

The seeded merchant accounts are demo shops (`test`, merchant id `demo-…`,
no real keys). On a deployment with `DEMO_LOGIN_EMAIL` set, a payment to such a
shop is settled the moment it starts (`isDemoAccount` in
`packages/api/src/lib/payments`): the client is sent straight back to the
cabinet with the credits added, and a visitor's booking is confirmed. Nothing
reaches a provider. A real account never behaves this way.

## Resetting

`packages/auth/script/demo-reset.ts` (nightly CronJob, `infra/synoro/demo.yaml`)
truncates the `synoro_demo` database and seeds again, so whatever visitors did
disappears. Locally: `bun db:seed` (database `synoro-demo`, `acme_test` or
`test` on localhost; it prints throw-away passwords for ordinary sign-in).
