# Services and the waiting list

## Services (`services`)

What a client books: a name, a length and a price in credits. The free intro
stays `practices.intro_minutes` (`docs/free-booking.md`); services are the
paid hours.

- **Row**: `name` (≤ 80), `minutes` (a multiple of 5, 15–240), `credits` (1–10,
  the price in credits of the balance), `position`, `active`. The owner edits
  them in «Настройки → Услуги» (`/practices/<id>/services`, `service.save`
  replaces the whole list; administrators read it with `service.list`).
- **Every practice starts with one**: an hour for one credit, named in the
  profession's words («Консультация», «Занятие»…). `practice.create` makes it,
  migration `0012` made it for the practices that existed. With one service the
  booking page shows no picker; with more, a select under the toolbar.
- **A service is never lost with its history**: leaving one out of `save`
  deletes it — or, when bookings (`bookings.service_id`) or waiting-list wishes
  point at it, archives it (`archived`, always switched off): it leaves the
  editor and the limit of eight, is never offered, and keeps its history.
- **A booking keeps its price**: `bookings.credits` is what the booking was
  charged, and what a refund gives back. `book`, `bookSeries` and `reserve`
  write it; free intros and closed time have 0. Changing a service's price
  never touches earlier bookings.
- **Which service**: every booking procedure takes an optional `serviceId`
  (`slots`, `book`, `seriesPreview`, `bookSeries`, `reserve`, `windows`,
  `waitlist.join`); missing — the practice's first active service
  (`resolveService`, `lib/services.ts`). A practice without any row books an
  hour for one credit, as before services existed. A foreign or switched-off id
  is `SERVICE_NOT_FOUND`.
- **Slots follow the length** (`computeSlots`, `minutes`): whole hours and
  «an hour with a break» (46–60 min: 50 + 10) start on the hour, other lengths
  on the half hour (`serviceStepMinutes`). A moved booking keeps its own
  length, whatever its service is now.
- **Online payment** (`reserve`): the package must cover the service
  (`PACKAGE_TOO_SMALL`), the settled payment spends `bookings.credits` on the
  confirmed booking (`settlePayment`), the rest of the package lands on the
  balance.

## Waiting list (`waitlist_entries`)

A wish for time that is not free yet: a range of days of the practice (≤ 60),
optionally hours of the day and a service. Free plan.

- **Join** (`waitlist.join`, public): a signed-in client uses their account; a
  visitor leaves name, phone and email as when booking and gets a passive
  account (`findOrCreateGuestMember`). Staff can't (`STAFF`), the email of staff
  must sign in (`SIGN_IN_REQUIRED`), three open wishes at most per person
  (`TOO_MANY`, counted and inserted under one advisory lock per person and
  practice), dates up to 60 days from today (`DATES_TOO_FAR`). The booking page shows «Лист ожидания» under the panel; a
  signed-in client sees their wishes there (`waitlist.mine`) and can leave
  (`waitlist.leave`).
- **Told once, and only if it still fits**: when a booking is cancelled (`cancelActiveBooking`, so client,
  staff, messenger and visitor's link), a series is cancelled or a booking is
  moved away, `notifyWaitlist` (`@synoro/jobs/waitlist`) finds the wishes the
  freed time fits (`wishStart`: day in range, and a start on the wished
  service's grid inside the free stretch that suits the wish's hours — the mail
  names that start, not the window's), leaves out time already taken again (a
  move only partly frees its old time), wishes for a switched-off service and
  whoever gave the time up, and writes to the five oldest — the `waitlist-notice` mail, or the messenger when the owner has «Про»
  (same `Deliver` as other notices). A wish is claimed with
  `notified_at` first, so it is told once however many cancellations race, and
  it is then done: asking again is a new wish. A notice that could not be sent
  gives the wish back (`notified_at` cleared) for the next free time. Wishes
  are read page by page, so a long line of wishes for other hours doesn't hide
  a fitting one.
- **Nothing is held**: the link leads to the booking page, whoever books first
  gets the time (`bookings_no_overlap`). Time freed by a lapsed unpaid hold
  (`hold_expired`) tells nobody.
- **Staff** see who waits on «Свободные окна» (`waitlist.list`) with phone and
  email, and take a wish off once it is settled.
