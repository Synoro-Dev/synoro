# Booking without an account

The main address of a booking page is `https://synoro.ru/p/<slug>`
(`BOOKING_URL=https://synoro.ru`). A visitor needs no account there: they pick
a time, leave **name, phone and email**, pay online and are booked. The phone
is required everywhere a person is booked or signs up for the cabinet.

## The flow

1. `booking.slots` (public) shows the free hours.
2. `booking.reserve` (public) validates the slot, then in this order:
   - finds or creates a **passive account** for the email (email not
     verified, no password) and a `client` membership in the practice. Staff
     emails are refused (`SIGN_IN_REQUIRED`); an existing account keeps its
     name and phone;
   - inserts the booking as `active` with `hold_until = now + 15 min` and
     `access_token_hash` (SHA-256 of the secret in the visitor's link). An
     unpaid hold blocks the slot (the `bookings_no_overlap` constraint counts
     it) until `hold_until` passes; every insert path first calls
     `releaseExpiredHolds`. One visitor holds at most 2 unpaid times;
   - creates the `payments` row (`booking_id` set) and the provider payment
     for the chosen package, with the return URL `…/b/<token>`;
   - mails the visitor that link (`booking-link` template).
3. The visitor pays on the provider's page and lands on `/b/<token>`
   (`booking.guest`), which checks a pending payment with the provider and
   shows `awaiting_payment | confirmed | expired | cancelled`.
4. `settlePayment` (webhook or the status check, exactly once, one SQL
   statement): the payment succeeds, the credits go to the balance, and if the
   booking still holds its time it is confirmed (`hold_until = null`) and one
   credit is spent on it. A package of 5 therefore books the chosen hour and
   leaves 4 on the visitor's balance. If the hold ran out and the time was
   released, the credits just land on the balance (`cancelled` state) and the
   visitor picks another time. A declined payment releases the time at once.

`booking.cancelGuest` cancels a confirmed booking by the token under the same
24-hour rule as a signed-in client and returns the credit to the balance.

## The visitor's cabinet

`/bookings` (the existing client cabinet): contact card with the **required
phone** (accounts opened by an emailed code have none and are asked for it
first), balances per practice with top-up, upcoming / past bookings, payment
history. A visitor enters it with the usual emailed 6-digit code — the account
already exists, so their bookings and balance are there. Booking while signed
in needs a phone on the profile (`PHONE_REQUIRED`; the booking page and the
cabinet ask for it).

## Hosts

- `synoro.ru/p/*`, `/b/*`, `/bookings`, `/auth/*` are routed to the app
  (`infra/synoro/app.yaml`); `app.synoro.ru/p/*` redirects (308) to
  `BOOKING_URL`, and the page carries `<link rel="canonical">` to it.
- `BOOKING_URL` also sets the share link in the dashboard, the payment return
  URL and the links in emails. Unset (local dev) everything stays on `APP_URL`.
- Renaming a practice address (`practices.slug`) is a data change: the page
  opens at `/p/<new slug>` as soon as it is saved.

## Not done

- The phone is not verified (no SMS provider); the email is verified only
  when the visitor signs in with a code.
- Booking requires online payment to be connected (a package and a provider);
  otherwise a visitor sees the sign-in prompt as before.
- No rate limit on `booking.reserve` beyond 2 unpaid holds per visitor.

## Google Calendar cleanup

Cancellation refunds credits before attempting Google Calendar cleanup. A
cancelled booking keeps its Google calendar/event ids until deletion succeeds;
404 and 410 also count as success. The `google-calendar-cleanup` Hatchet workflow
retries pending deletions every five minutes, processing up to 100 bookings per
run. Failed attempts move behind older pending work. Configure Hatchet and run
`bun jobs:dev` (the deployed worker uses the same workflow), with `POSTGRES_URL`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and the same `PAYMENTS_SECRET_KEY` as the
app. Without a configured worker, pending deletions remain in the database.

Migration `0002_booking_no_overlap` preserves all existing bookings and their
credit/payment history. If active bookings overlap, it fails before adding the
constraint. Review those bookings and use the normal cancellation/refund flow
before rerunning it; the migration never chooses which client loses a slot.
