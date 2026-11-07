# Free intro and phone booking

Two ways into the schedule beyond paid online booking: the free intro a new
client books themselves, and the free-windows screen for whoever answers the
phone. A practice paid in person books every service without payment the
same way: `docs/pay-at-visit.md`.

## Free intro (`bookings.kind = 'free'`)

The intro starts on the half-hour grid (:00 or :30), no payment. It lasts
`practices.intro_minutes` — 30 by default; the owner picks 30, 45, 60 or 90
minutes (`INTRO_MINUTES` in `@synoro/validators`) next to the switch below,
via `practice.setFreeBooking { introMinutes }`. A new length applies to new
intros only: booked ones keep their `ends_at`. `computeSlots` takes it as
`introMinutes`, separate from the half-hour step, so a 90-minute trial
workout can still start at 10:30. Its name follows the profession
(`professionTerms(...).free`): «Знакомство», «Пробная тренировка»,
«Первичная консультация»…

- **Staff** book it in the calendar or on «Свободные окна» for a guest with a
  name and a phone (`booking.bookFree`, no account). Always available.
- **Visitors** book it themselves on `/<slug>` when the owner turned on
  `practices.free_booking_enabled` («Страница записи» → «… — бесплатно»,
  `practice.setFreeBooking`). Free plan, no «Про» needed. The page shows a
  second tab next to the paid hour; with no way to book paid hours (no online
  payment, no balance) it opens on the intro.

`booking.bookIntro` (public):

1. Checks the switch, the questionnaire («Про»), the schedule and Google busy
   time, like `reserve`.
2. Who books: a signed-in client as themselves (phone required, joins the
   practice if needed; staff get `STAFF`); otherwise the visitor's name, phone
   and email find or create a passive client, as in `docs/guest-booking.md`.
3. **Once per person and practice**: refused with `ALREADY_USED` when the
   member, or any booking with the same phone (staff-made guest bookings
   included), has an active intro or a no-show one. A cancelled intro does not
   count. The check and the insert run in one transaction under an advisory
   lock per practice, so two tabs can't both pass the check.
4. Inserts the booking confirmed (`hold_until` null) with `member_id`, the
   name and phone in `guest_name` / `guest_phone`, and `access_token_hash`.
   The `bookings_no_overlap` constraint settles races with other bookings.
5. Exports it to Google Calendar, tells staff (`staff-booking`, «бесплатная
   встреча»), and mails the visitor `booking-link` with `intro` set: confirmed,
   free, the `/b/<token>` link and the practice's video room. Once that mail
   went out, the reminders already due are marked sent
   (`markRemindersCovered`); if it failed, they still go.

Afterwards the intro behaves like a client booking: it is in `booking.mine`
(`kind: "free"`) and on `/b/<token>` (`booking.guest`, states `confirmed` or
`cancelled`); the client cancels it **until it starts** (`clientMayCancel`;
paid ones keep the 24-hour rule), nothing is refunded. Reminders, the video
link and cancellation mails go out as for paid bookings
(`packages/jobs/src/booking-video.ts`, `CLIENT_KINDS`), without the balance
wording. Staff-made guest intros have no account, so they get no mail.

## Free windows for staff (`/practices/<id>/windows`)

For the administrator (or the specialist) on the phone: a week at a time,
per day the continuous free windows («Свободно 10:00–13:00, 15:00–17:00») and
the start times of a paid hour or an intro (tab), the nearest free time on
top. A time opens the new-entry dialog:

- **Клиент** — search by name or phone digits (`8 900…` and `+7 900…` both
  match), balance next to each name; books from the balance.
- **Знакомство** — a new caller by name and phone. A phone that belongs to a
  client is recognised, with a button to book them as a client instead.

«Скопировать» puts the week's free times into text for a messenger. Switching
practices in the sidebar keeps the section, so an administrator of several
specialists moves between their windows directly.

`booking.windows` (staff only) computes it with `freeWindows` in
`lib/schedule.ts`: working hours minus active bookings and holds, blocks,
Google busy time and the past. Unlike `booking.slots` it lists intro starts
even when visitors can't book them. Days and times are in the practice's zone —
what the caller is told; a note appears when the viewer's zone differs (the
new-entry dialog shows the viewer's time, like the calendar).

## Not done

- No limit of intros per day, and no minimum notice before the start.
- Once-per-person trusts the phone and email typed in; neither is verified.
