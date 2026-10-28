import { finishGoogleConnect } from "@synoro/api";
import { env } from "@synoro/config";
import { db } from "@synoro/db";

/**
 * Google's OAuth redirect after the specialist allows (or refuses) calendar
 * access; registered in the Google Cloud console as
 * `<APP_URL>/api/google-calendar/callback`. Saves the connection and sends
 * them back to the schedule page — see `finishGoogleConnect`.
 */
export async function GET(request: Request) {
  const { auth } = await import("~/auth/server");
  const session = await auth.api.getSession({ headers: request.headers });

  const target = await finishGoogleConnect(
    db,
    new URL(request.url),
    session?.user.id,
  );
  return Response.redirect(new URL(target, env.APP_URL), 303);
}
