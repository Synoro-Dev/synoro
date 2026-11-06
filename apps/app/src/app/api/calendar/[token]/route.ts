import { calendarFeedBody } from "@synoro/api";
import { db } from "@synoro/db";

/**
 * The practice's schedule for a calendar subscription. The secret in the
 * address is the only key: calendars can't sign in. Reissued in the settings.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const body = await calendarFeedBody(db, (await params).token);
  if (body === null) return new Response("Not found", { status: 404 });

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
