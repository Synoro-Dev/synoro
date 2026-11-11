# Booking without an account

The main address of a booking page is `https://synoro.ru/<slug>`
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
rules as a signed-in client (`docs/cancel-rules.md`): the credit back up to the
practice's deadline, later only with `forfeit: true` where it is allowed.

The free intro needs no payment: `booking.bookIntro` confirms it at once
and mails the same `/b/<token>` link — see `docs/free-booking.md`.

The page lays the free time out three ways, switched by the visitor
(`components/booking/booking-views.ts`, `booking-week.tsx`): **Месяц** (a
month of days, the hours of one), **Неделя** (a timetable of hours × seven
days, half-hour times in the lower half of their hour) and **Столбцы**
(seven day columns of times). The choice is remembered per browser
(`localStorage` `synoro:booking-view`); a phone always gets the month. The
week views ask `booking.slots` for one week with a day of padding.

## The visitor's cabinet

`/bookings` (the existing client cabinet): contact card with the **required
phone** (accounts opened by an emailed code have none and are asked for it
first), balances per practice with top-up, upcoming / past bookings, payment
history. A visitor enters it with the usual emailed 6-digit code — the account
already exists, so their bookings and balance are there. Booking while signed
in needs a phone on the profile (`PHONE_REQUIRED`; the booking page and the
cabinet ask for it).

## Moving a booking

`booking.reschedule` moves a confirmed booking (`consultation` or `free`) to
another time: same id, link, video room and length, the balance and its journal
untouched. One `UPDATE` does it and `bookings_no_overlap` decides races, so a
taken time (`SLOT_UNAVAILABLE`) leaves the booking where it was. The rules are
those of cancelling (`checkMove`, `clientMayMove`): a client up to the
practice's deadline (`cancel_hours`; a free intro until it starts), later
`TOO_LATE`, also where a late cancellation is allowed; staff at any
time. Of a series only that booking moves. Closed time and unpaid holds don't
move, and there is no moving by the `/b/<token>` link: a visitor signs in.

The dialogs (`components/booking/slot-picker.tsx`) offer the times of
`booking.rescheduleSlots`: `booking.slots` for this booking, with its own length
and without counting its own time (and Google event) as busy. Free/busy has no
event ids, so a Google block of exactly the booking's time is checked against
`events.list`; unless that says it is the booking's event alone, or when a block
is wider than the booking, the time stays busy (`googleBusyForMove`).

After the move the reminders start over, the Google Calendar event gets the new
time (`moveBookingEvent`), and the client and staff are told (`booking-notice`
and `staff-booking` with `notice: moved`), but not the one who moved it. A guest
booked by phone has no account: staff tell them themselves.

Anything that read the booking before a move holds only for the time it read:
a client's cancel (`cancelBookingRows` with `startsAt`) and the reminder cron's
claims are conditional on `starts_at`, and `moveBookingEvent` reads the booking
again after writing to Google, so moves arriving out of order end on the latest
time.

## Contact for clients

`practices.client_contact` is free text (a phone, Telegram…) the owner sets on
the booking page's settings (`practice.setContact`). Clients see it on a
**confirmed** booking only (`booking.mine.contact`, `booking.guest.contact`):
in the cabinet's dialog when it is too late to change a booking themselves, and
on `/b/<token>`. Never in public procedures (`slots`, `bySlug`), and not in
`practice.get` for clients, because anyone can join a practice.

## Video meetings

The specialist gives clients a video link (Толк, Телемост, Google Meet, Zoom —
any `https` link; `videoServiceName` in `@synoro/validators` labels the known
ones). No provider API is involved: the link is pasted by hand.

- `practices.video_url` — the permanent room, set by the owner on the practice
  overview (`practice.setVideoUrl`).
- `bookings.meeting_url` — the link of one booking, set by staff in the
  booking card (`booking.setMeetingUrl`). The link in force is
  `meeting_url ?? video_url`; clearing the field returns to the practice room.
- Validation (`normalizeVideoUrl`): `https` only, no login in the URL, a host
  with a dot; a missing scheme is added. Anything else is refused.

The client learns about it in four places, only for a **confirmed** paid
booking (never while `hold_until` is set or after cancellation):

1. the `booking-notice` email (`notice: confirmed`) sent when the booking is
   confirmed — by `settlePayment` (once, by the call that settled the
   payment) or by `booking.book` for a credit;
2. the block on `/b/<token>` (`booking.guest.videoUrl`) and the button in the
   cabinet `/bookings` (`booking.mine.videoUrl`);
3. the same email (`notice: link`) when the specialist sets or changes the
   link of an upcoming booking, or the practice room (every upcoming booking
   without its own link) — nothing is sent when the link was cleared;
4. reminders 24 h and 1 h ahead (`booking-reminders` Hatchet workflow, every
   5 min, `reminder_day_sent_at` / `reminder_hour_sent_at` claim each one
   before sending). A booking with no link is not reminded. Without a Hatchet
   worker there are no reminders; the other mails go out inline.

Logic lives in `packages/jobs/src/booking-video.ts` (mails are best effort and
never undo a booking). The link also goes into the description of the
specialist's Google Calendar event when it is written; later changes of the
link do **not** update an existing event. Free (staff-made) bookings can have a
link too, but there is no email for the guest — staff pass it on.

## Hosts

- `synoro.ru/<slug>` (one segment, optionally `/avatar.jpg`), `/b/*`,
  `/bookings`, `/auth/*` are routed to the app (`infra/synoro/app.yaml`); the
  landing keeps `/`, `/legal`, `/solutions/*` (`landing.yaml`, higher
  priority). `app.synoro.ru/<slug>` redirects (308) to `BOOKING_URL`, and the
  page carries `<link rel="canonical">` to it.
- The old address `/p/<slug>` (links already mailed or posted) redirects
  (308) to `/<slug>` in `proxy.ts`; keep it for good.
- `BOOKING_URL` also sets the share link in the dashboard, the payment return
  URL and the links in emails. Unset (local dev) everything stays on `APP_URL`.
- Renaming a practice address (`practices.slug`) is a data change: the page
  opens at `/<new slug>` as soon as it is saved.

## Embedding in an iframe

A booking page (`/<slug>`) may be framed by any site (`frame-ancestors *`, no `X-Frame-Options`;
`next.config.ts`). Everything else stays `frame-ancestors 'none'` + `DENY`. The
dashboard has a "code for your site" button that copies:

```html
<iframe data-synoro src="https://synoro.ru/<slug>" title="Онлайн-запись"
  style="width:100%;height:720px;border:0" loading="lazy"></iframe>
<script>/* sets the frame's height from `synoro:height` messages */</script>
```

The code comes from `embedCode` (`~/lib/embed`). The framed page reports its
height (`reportFrameHeight`, a `postMessage` with the height only), and the
script resizes the frame that sent it. A site builder that strips scripts leaves
the frame at 720px, scrolling inside. On a tall frame anything `fixed` on the
page (a dialog, a toast) sits relative to the frame, not the visitor's screen;
on a short one, dialogs must scroll inside (`max-h-[calc(100dvh-2rem)]`), since
the height reported is the page's, without them.

In a cross-site frame the visitor is a guest (the session cookie is
`SameSite=Lax`, so it isn't sent cross-site). A same-site frame can retain the
signed-in session. The provider's payment page can't be framed, so both guest
booking and balance top-up use `leaveFrame` (`~/lib/leave-frame`) to open it in
the top window; sign-in and cabinet links use `target="_top"`. A guest booking
returns to `/b/<token>` in that window. Browsers may block top navigation after
the payment request because of sandbox restrictions or expired user activation.
After a payment is created, both forms also show its checkout link in a new
tab so the visitor can retry without creating another payment. The embedding
site must allow top navigation or popups for checkout to open outside the frame.
The practice's own host (`/site/*`) is not framable.

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
