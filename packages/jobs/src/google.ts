/**
 * Thin client for the Google OAuth 2.0 and Calendar v3 REST endpoints, on
 * plain `fetch` (no googleapis dependency). Knows nothing of the database:
 * see `./google-calendar.ts` for connection handling.
 */
import { env } from "@synoro/config";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API_URL = "https://www.googleapis.com/calendar/v3";

const READ_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const SCOPES = ["openid", "email", READ_SCOPE, EVENTS_SCOPE];

const TIMEOUT_MS = 8000;

/**
 * A failed call. `revoked` means the refresh token no longer works (access
 * withdrawn in the Google account, password changed…): only reconnecting
 * helps. `unavailable` is a network failure or a 5xx.
 */
export class GoogleError extends Error {
  constructor(
    message: string,
    readonly kind: "revoked" | "unauthorized" | "unavailable" | "rejected",
    readonly status?: number,
  ) {
    super(message);
    this.name = "GoogleError";
  }
}

function redirectUri() {
  return new URL("/api/google-calendar/callback", env.APP_URL).href;
}

function credentials() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
  }
  return {
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
  };
}

/**
 * Google's consent page. `prompt=consent` makes every connect return a
 * refresh token, also when the account granted access before.
 */
export function authorizationUrl(state: string) {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: credentials().client_id,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return url.href;
}

async function send(url: string, init: RequestInit) {
  try {
    return await fetch(url, {
      ...init,
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(TIMEOUT_MS)])
        : AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new GoogleError(
      error instanceof Error ? error.message : String(error),
      "unavailable",
    );
  }
}

async function failure(response: Response, what: string) {
  const body = (await response.json().catch(() => null)) as {
    error?: string | { message?: string };
    error_description?: string;
  } | null;
  const detail =
    typeof body?.error === "string"
      ? (body.error_description ?? body.error)
      : (body?.error?.message ?? response.statusText);
  const kind =
    typeof body?.error === "string" && body.error === "invalid_grant"
      ? "revoked"
      : response.status === 401
        ? "unauthorized"
        : response.status >= 500 || response.status === 429
          ? "unavailable"
          : "rejected";
  return new GoogleError(
    `${what}: ${response.status} ${detail}`,
    kind,
    response.status,
  );
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

async function tokenRequest(
  params: Record<string, string>,
  signal?: AbortSignal,
) {
  const response = await send(TOKEN_URL, {
    signal,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...credentials(), ...params }),
  });
  if (!response.ok) throw await failure(response, "Google token");
  return (await response.json()) as TokenResponse;
}

function emailFromIdToken(idToken: string | undefined) {
  // Straight from Google's token endpoint over TLS: no signature check needed.
  const payload = idToken?.split(".")[1];
  if (!payload) return undefined;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
    email?: unknown;
  };
  return typeof claims.email === "string" ? claims.email : undefined;
}

/**
 * Trade the code from the consent page for tokens. Fails with `rejected`
 * when the account unticked calendar access on the consent page.
 */
export async function exchangeCode(code: string) {
  const token = await tokenRequest({
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
  });
  const granted = new Set(token.scope?.split(" "));
  const email = emailFromIdToken(token.id_token);
  if (!granted.has(READ_SCOPE) || !granted.has(EVENTS_SCOPE)) {
    throw new GoogleError("Calendar access was not granted", "rejected");
  }
  if (!token.refresh_token || !email) {
    throw new GoogleError("No refresh token or email returned", "rejected");
  }
  return {
    email,
    refreshToken: token.refresh_token,
    accessToken: token.access_token,
    expiresAt: new Date(Date.now() + token.expires_in * 1000),
  };
}

export async function refreshAccessToken(
  refreshToken: string,
  signal?: AbortSignal,
) {
  const token = await tokenRequest(
    {
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    },
    signal,
  );
  return {
    accessToken: token.access_token,
    expiresAt: new Date(Date.now() + token.expires_in * 1000),
  };
}

/** Withdraw the app's access; failures don't matter, the row goes anyway. */
export async function revokeToken(token: string) {
  await send(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

async function api<T>(
  accessToken: string,
  path: string,
  init: RequestInit & { what: string; allow?: number[] },
) {
  const response = await send(`${API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (init.allow?.includes(response.status)) return undefined;
  if (!response.ok) throw await failure(response, init.what);
  if (response.status === 204) return undefined;
  return (await response.json()) as T;
}

export interface GoogleCalendarInfo {
  id: string;
  summary: string;
  primary: boolean;
  canWrite: boolean;
  color: string | null;
}

/** Calendars in the account's list; the primary one is reported as `primary`. */
export async function listCalendars(
  accessToken: string,
): Promise<GoogleCalendarInfo[]> {
  const data = await api<{
    items?: {
      id: string;
      summary?: string;
      summaryOverride?: string;
      primary?: boolean;
      accessRole?: string;
      backgroundColor?: string;
    }[];
  }>(accessToken, "/users/me/calendarList?minAccessRole=reader", {
    what: "Google calendarList",
  });
  return (data?.items ?? []).map((c) => ({
    id: c.primary ? "primary" : c.id,
    summary: c.summaryOverride ?? c.summary ?? c.id,
    primary: c.primary === true,
    canWrite: c.accessRole === "owner" || c.accessRole === "writer",
    color: c.backgroundColor ?? null,
  }));
}

/**
 * Busy ranges of `calendarIds` within [start, end), all calendars merged.
 * A calendar Google can't read (deleted, unshared) is skipped and named in
 * `failed`.
 */
export async function freeBusy(
  accessToken: string,
  calendarIds: string[],
  start: Date,
  end: Date,
  signal?: AbortSignal,
) {
  const data = await api<{
    calendars?: Record<
      string,
      { busy?: { start: string; end: string }[]; errors?: unknown[] }
    >;
  }>(accessToken, "/freeBusy", {
    what: "Google freeBusy",
    signal,
    method: "POST",
    body: JSON.stringify({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      items: calendarIds.map((id) => ({ id })),
    }),
  });
  const busy: { startsAt: Date; endsAt: Date }[] = [];
  const failed: string[] = [];
  for (const [id, calendar] of Object.entries(data?.calendars ?? {})) {
    if (calendar.errors?.length) failed.push(id);
    for (const b of calendar.busy ?? []) {
      busy.push({ startsAt: new Date(b.start), endsAt: new Date(b.end) });
    }
  }
  return { busy, failed };
}

export interface GoogleEvent {
  /** base32hex (a–v, 0–9), 5–1024 chars: lets a retry find the same event. */
  id: string;
  summary: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  bookingId: string;
}

/** Create the event; one that already exists (a retry) counts as created. */
export async function insertEvent(
  accessToken: string,
  calendarId: string,
  event: GoogleEvent,
) {
  await api(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
    {
      what: "Google events.insert",
      method: "POST",
      allow: [409],
      body: JSON.stringify({
        id: event.id,
        summary: event.summary,
        description: event.description,
        start: {
          dateTime: event.startsAt.toISOString(),
          timeZone: event.timeZone,
        },
        end: { dateTime: event.endsAt.toISOString(), timeZone: event.timeZone },
        extendedProperties: { private: { synoroBookingId: event.bookingId } },
      }),
    },
  );
}

/** Delete the event; one already gone counts as deleted. */
export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
) {
  await api(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    { what: "Google events.delete", method: "DELETE", allow: [404, 410] },
  );
}
