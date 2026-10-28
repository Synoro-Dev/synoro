import { env, logger, paths } from "@synoro/config";
import {
  Booking,
  type Database,
  eq,
  GoogleCalendarConnection,
  PracticeMember,
  user,
} from "@synoro/db";
import { capitalize, professionTerms } from "@synoro/validators";

import { findOwnerMembership, findPractice } from "../practice-access";
import { overlaps, type TimeRange } from "../schedule";
import { decryptSecret, encryptSecret, secretsAvailable } from "../secrets";
import {
  deleteEvent,
  exchangeCode,
  freeBusy,
  GoogleError,
  insertEvent,
  refreshAccessToken,
  revokeToken,
} from "./google";

export {
  authorizationUrl,
  GoogleError,
  listCalendars,
} from "./google";

type Connection = typeof GoogleCalendarConnection.$inferSelect;
type BookingRow = typeof Booking.$inferSelect;

/** How long the consent page may take before its `state` is refused. */
const STATE_TTL_MS = 30 * 60 * 1000;
/** Refresh the access token this long before Google says it expires. */
const EXPIRY_MARGIN_MS = 60 * 1000;

/** False when the OAuth client or PAYMENTS_SECRET_KEY is missing. */
export function googleCalendarAvailable() {
  return (
    !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET && secretsAvailable()
  );
}

/**
 * The OAuth `state`: practice and user, encrypted (AES-GCM, so it can't be
 * forged or altered). The callback only accepts it from the same signed-in
 * user, which keeps another person's calendar from being slipped in.
 */
export function connectState(practiceId: string, userId: string) {
  return encryptSecret(
    JSON.stringify({ practiceId, userId, exp: Date.now() + STATE_TTL_MS }),
  );
}

function readState(state: string) {
  try {
    const value = JSON.parse(decryptSecret(state)) as {
      practiceId?: unknown;
      userId?: unknown;
      exp?: unknown;
    };
    if (
      typeof value.practiceId !== "string" ||
      typeof value.userId !== "string" ||
      typeof value.exp !== "number" ||
      value.exp < Date.now()
    ) {
      return undefined;
    }
    return { practiceId: value.practiceId, userId: value.userId };
  } catch {
    return undefined;
  }
}

export function findConnection(db: Database, practiceId: string) {
  return db.query.GoogleCalendarConnection.findFirst({
    where: eq(GoogleCalendarConnection.practiceId, practiceId),
  });
}

/** What the specialist sees; tokens never leave the server. */
export function connectionInfo(connection: Connection | undefined) {
  return connection
    ? {
        email: connection.email,
        busyCalendarIds: connection.busyCalendarIds,
        eventsCalendarId: connection.eventsCalendarId,
        exportBookings: connection.exportBookings,
        lastError: connection.lastError,
        lastErrorAt: connection.lastErrorAt,
        connectedAt: connection.createdAt,
      }
    : null;
}

function errorMessage(error: unknown) {
  if (error instanceof GoogleError && error.kind === "revoked") {
    return "Доступ к Google Календарю отозван — подключите его заново";
  }
  return "Google Календарь не ответил — проверьте подключение";
}

async function markError(db: Database, connection: Connection, error: unknown) {
  logger.warn("google_calendar.failed", {
    practiceId: connection.practiceId,
    kind: error instanceof GoogleError ? error.kind : "internal",
    error: error instanceof Error ? error.message : String(error),
  });
  await db
    .update(GoogleCalendarConnection)
    .set({ lastError: errorMessage(error), lastErrorAt: new Date() })
    .where(eq(GoogleCalendarConnection.id, connection.id));
}

async function clearError(db: Database, connection: Connection) {
  if (connection.lastError === null) return;
  await db
    .update(GoogleCalendarConnection)
    .set({ lastError: null, lastErrorAt: null })
    .where(eq(GoogleCalendarConnection.id, connection.id));
}

async function freshAccessToken(db: Database, connection: Connection) {
  const { accessToken, expiresAt } = await refreshAccessToken(
    decryptSecret(connection.refreshToken),
  );
  await db
    .update(GoogleCalendarConnection)
    .set({
      accessToken: encryptSecret(accessToken),
      accessTokenExpiresAt: expiresAt,
    })
    .where(eq(GoogleCalendarConnection.id, connection.id));
  return accessToken;
}

/**
 * Run `call` with a working access token: the stored one while it is
 * valid, else a refreshed one; a 401 gets one more try with a new token.
 * Failures are recorded on the connection (shown to the specialist) and
 * rethrown; success clears the recorded one.
 */
export async function withGoogle<T>(
  db: Database,
  connection: Connection,
  call: (accessToken: string) => Promise<T>,
) {
  try {
    const stored =
      connection.accessToken &&
      connection.accessTokenExpiresAt &&
      connection.accessTokenExpiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now()
        ? decryptSecret(connection.accessToken)
        : await freshAccessToken(db, connection);
    let result: T;
    try {
      result = await call(stored);
    } catch (error) {
      if (!(error instanceof GoogleError && error.kind === "unauthorized")) {
        throw error;
      }
      result = await call(await freshAccessToken(db, connection));
    }
    await clearError(db, connection);
    return result;
  } catch (error) {
    await markError(db, connection, error);
    throw error;
  }
}

/**
 * Busy time from the specialist's Google calendars in [start, end). Google
 * being down must not stop bookings: on failure this logs, records the
 * error and returns nothing.
 */
export async function googleBusy(
  db: Database,
  practiceId: string,
  start: Date,
  end: Date,
): Promise<TimeRange[]> {
  if (!googleCalendarAvailable()) return [];
  const connection = await findConnection(db, practiceId);
  if (!connection?.busyCalendarIds.length) return [];
  try {
    const { busy, failed } = await withGoogle(db, connection, (token) =>
      freeBusy(token, connection.busyCalendarIds, start, end),
    );
    if (failed.length) {
      logger.warn("google_calendar.calendar_unreadable", {
        practiceId,
        calendars: failed,
      });
    }
    return busy;
  } catch {
    return [];
  }
}

/** Whether Google says the specialist is busy at some point of `range`. */
export async function isBusyInGoogle(
  db: Database,
  practiceId: string,
  range: TimeRange,
) {
  const busy = await googleBusy(db, practiceId, range.startsAt, range.endsAt);
  return busy.some((b) => overlaps(b, range));
}

/** Google event ids are base32hex; a UUID's hex digits fit as they are. */
function eventIdFor(bookingId: string) {
  return bookingId.replaceAll("-", "");
}

async function describeBooking(db: Database, booking: BookingRow) {
  const [practice, client] = await Promise.all([
    findPractice(db, booking.practiceId),
    booking.memberId
      ? db
          .select({ name: user.name, phone: user.phone })
          .from(PracticeMember)
          .innerJoin(user, eq(user.id, PracticeMember.userId))
          .where(eq(PracticeMember.id, booking.memberId))
          .then(([row]) => row)
      : undefined,
  ]);
  if (!practice) return undefined;

  const terms = professionTerms(practice.profession);
  const what =
    booking.kind === "free" ? terms.free : capitalize(terms.credit[0]);
  const who = booking.guestName ?? client?.name;
  const phone = booking.guestPhone ?? client?.phone;
  const calendarUrl = new URL(
    paths.booking.calendar(booking.practiceId),
    env.APP_URL,
  );
  const description = [
    phone && `Телефон: ${phone}`,
    booking.guestContact && `Контакт: ${booking.guestContact}`,
    booking.note && `Комментарий: ${booking.note}`,
    `${practice.name}: ${calendarUrl.href}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    summary: who ? `${what} — ${who}` : what,
    description,
    timeZone: practice.timezone,
  };
}

/**
 * Mirror a confirmed booking (paid consultation or free one) as an event in
 * the specialist's Google Calendar. Blocks, unpaid holds and bookings
 * already mirrored are skipped. Best effort: a failure is logged and
 * recorded, the booking stands.
 */
export async function exportBooking(db: Database, bookingId: string) {
  if (!googleCalendarAvailable()) return;
  const booking = await db.query.Booking.findFirst({
    where: eq(Booking.id, bookingId),
  });
  if (
    !booking ||
    booking.kind === "blocked" ||
    booking.status !== "active" ||
    booking.holdUntil !== null ||
    booking.googleEventId !== null
  ) {
    return;
  }
  const connection = await findConnection(db, booking.practiceId);
  if (!connection?.exportBookings) return;

  try {
    const details = await describeBooking(db, booking);
    if (!details) return;
    const eventId = eventIdFor(booking.id);
    await withGoogle(db, connection, (token) =>
      insertEvent(token, connection.eventsCalendarId, {
        id: eventId,
        bookingId: booking.id,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        ...details,
      }),
    );
    await db
      .update(Booking)
      .set({
        googleCalendarId: connection.eventsCalendarId,
        googleEventId: eventId,
      })
      .where(eq(Booking.id, booking.id));
  } catch {
    // Recorded by withGoogle.
  }
}

/** Remove a cancelled booking's event, if it has one. Best effort. */
export async function removeBookingEvent(db: Database, booking: BookingRow) {
  const { googleCalendarId, googleEventId } = booking;
  if (!googleCalendarId || !googleEventId || !googleCalendarAvailable()) return;
  const connection = await findConnection(db, booking.practiceId);
  if (!connection) return;
  try {
    await withGoogle(db, connection, (token) =>
      deleteEvent(token, googleCalendarId, googleEventId),
    );
  } catch {
    // Recorded by withGoogle.
  }
}

/** Forget the connection and withdraw the app's access in Google. */
export async function disconnectGoogle(db: Database, practiceId: string) {
  const connection = await findConnection(db, practiceId);
  if (!connection) return;
  await db
    .delete(GoogleCalendarConnection)
    .where(eq(GoogleCalendarConnection.id, connection.id));
  await revokeToken(decryptSecret(connection.refreshToken));
}

/**
 * `GET /api/google-calendar/callback`: Google sends the specialist back
 * here from the consent page. Returns where to redirect them — the
 * practice's schedule page with `?google=connected` or `?google=<error>`.
 *
 * Only the owner who started the connect (same signed-in user, still the
 * owner) can finish it. Reconnecting the same Google account keeps the
 * chosen calendars; another account starts from its primary calendar.
 */
export async function finishGoogleConnect(
  db: Database,
  url: URL,
  userId: string | undefined,
) {
  const state = readState(url.searchParams.get("state") ?? "");
  if (!state || !userId || state.userId !== userId) {
    return `${paths.booking.practices}?google=invalid`;
  }
  const back = (result: string) =>
    `${paths.booking.schedule(state.practiceId)}?google=${result}`;

  const code = url.searchParams.get("code");
  if (!code) return back("denied");

  const owner = await findOwnerMembership(db, state.practiceId, userId);
  if (!owner || !googleCalendarAvailable()) {
    return back("invalid");
  }

  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    tokens = await exchangeCode(code);
  } catch (error) {
    logger.warn("google_calendar.connect_failed", {
      practiceId: state.practiceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return back(
      error instanceof GoogleError && error.kind === "rejected"
        ? "scopes"
        : "error",
    );
  }

  const existing = await findConnection(db, state.practiceId);
  const sameAccount = existing?.email === tokens.email;
  const values = {
    connectedById: userId,
    email: tokens.email,
    refreshToken: encryptSecret(tokens.refreshToken),
    accessToken: encryptSecret(tokens.accessToken),
    accessTokenExpiresAt: tokens.expiresAt,
    busyCalendarIds: sameAccount ? existing.busyCalendarIds : ["primary"],
    eventsCalendarId: sameAccount ? existing.eventsCalendarId : "primary",
    lastError: null,
    lastErrorAt: null,
  };
  await db
    .insert(GoogleCalendarConnection)
    .values({ practiceId: state.practiceId, ...values })
    .onConflictDoUpdate({
      target: GoogleCalendarConnection.practiceId,
      set: values,
    });
  if (existing && !sameAccount) {
    await revokeToken(decryptSecret(existing.refreshToken));
  }
  logger.info("google_calendar.connected", { practiceId: state.practiceId });
  return back("connected");
}
