import { env, logger } from "@synoro/config";
import {
  decryptSecret,
  encryptSecret,
  secretsAvailable,
} from "@synoro/config/secrets";
import {
  and,
  asc,
  Booking,
  type Database,
  eq,
  GoogleCalendarConnection,
  isNotNull,
} from "@synoro/db";
import { deleteEvent, GoogleError, refreshAccessToken } from "./google";

export {
  authorizationUrl,
  deleteEvent,
  exchangeCode,
  freeBusy,
  type GoogleCalendarInfo,
  GoogleError,
  insertEvent,
  listCalendars,
  revokeToken,
} from "./google";

type Connection = typeof GoogleCalendarConnection.$inferSelect;
type BookingRow = typeof Booking.$inferSelect;

/** Refresh the access token this long before Google says it expires. */
const EXPIRY_MARGIN_MS = 60 * 1000;

/** False when the OAuth client or PAYMENTS_SECRET_KEY is missing. */
export function googleCalendarAvailable() {
  return (
    !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET && secretsAvailable()
  );
}

export function findConnection(db: Database, practiceId: string) {
  return db.query.GoogleCalendarConnection.findFirst({
    where: eq(GoogleCalendarConnection.practiceId, practiceId),
  });
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

async function freshAccessToken(
  db: Database,
  connection: Connection,
  signal?: AbortSignal,
) {
  const { accessToken, expiresAt } = await refreshAccessToken(
    decryptSecret(connection.refreshToken),
    signal,
  );
  signal?.throwIfAborted();
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
  signal?: AbortSignal,
) {
  try {
    signal?.throwIfAborted();
    const stored =
      connection.accessToken &&
      connection.accessTokenExpiresAt &&
      connection.accessTokenExpiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now()
        ? decryptSecret(connection.accessToken)
        : await freshAccessToken(db, connection, signal);
    signal?.throwIfAborted();
    let result: T;
    try {
      result = await call(stored);
    } catch (error) {
      if (!(error instanceof GoogleError && error.kind === "unauthorized")) {
        throw error;
      }
      signal?.throwIfAborted();
      const fresh = await freshAccessToken(db, connection, signal);
      signal?.throwIfAborted();
      result = await call(fresh);
    }
    signal?.throwIfAborted();
    await clearError(db, connection);
    return result;
  } catch (error) {
    await markError(db, connection, error);
    throw error;
  }
}

/**
 * Cancelled bookings with Google ids are the durable cleanup queue. Keep the
 * ids on failure; clear them only after Google confirms deletion (404/410
 * count too). Every part of cleanup is best effort for the caller.
 */
export async function removeBookingEvent(db: Database, booking: BookingRow) {
  try {
    const { googleCalendarId, googleEventId } = booking;
    if (!googleCalendarId || !googleEventId) return false;
    // Also retain ids when cancellation raced with an in-flight export.
    // Touch updatedAt so a failing item moves behind other pending work.
    await db
      .update(Booking)
      .set({ googleCalendarId, googleEventId, updatedAt: new Date() })
      .where(and(eq(Booking.id, booking.id), eq(Booking.status, "cancelled")));
    if (!googleCalendarAvailable()) return false;
    const connection = await findConnection(db, booking.practiceId);
    if (!connection) return false;
    await withGoogle(db, connection, (token) =>
      deleteEvent(token, googleCalendarId, googleEventId),
    );
    await db
      .update(Booking)
      .set({ googleCalendarId: null, googleEventId: null })
      .where(
        and(
          eq(Booking.id, booking.id),
          eq(Booking.status, "cancelled"),
          eq(Booking.googleCalendarId, googleCalendarId),
          eq(Booking.googleEventId, googleEventId),
        ),
      );
    return true;
  } catch (error) {
    logger.warn("google_calendar.cleanup_pending", {
      bookingId: booking.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Retry persisted cleanup, including work left by failed enqueues/restarts. */
export async function reconcileGoogleCalendar(db: Database) {
  if (!googleCalendarAvailable()) return;
  const pending = await db
    .select()
    .from(Booking)
    .where(
      and(
        eq(Booking.status, "cancelled"),
        isNotNull(Booking.googleCalendarId),
        isNotNull(Booking.googleEventId),
      ),
    )
    .orderBy(asc(Booking.updatedAt), asc(Booking.id))
    .limit(100);
  for (const booking of pending) await removeBookingEvent(db, booking);
}
