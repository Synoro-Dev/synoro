import { isDefinedError } from "@orpc/server";

import { api } from "~/orpc/server";

/**
 * Which practice this host serves: `{ practiceId }` for an active own domain,
 * 404 otherwise. The domain readiness probe (`servesHttps` in
 * `@synoro/jobs/custom-domains`) asks it over https on the domain itself, so a
 * working answer proves the certificate, the route, the app and the database
 * at once — unlike the booking page, which streams a 200 before its data
 * loads. `/api` passes `proxy.ts` untouched on practice hosts.
 * See docs/custom-domains.md.
 */
export async function GET(request: Request) {
  const host = request.headers.get("host");
  if (!host) return new Response(null, { status: 400 });

  try {
    const practice = await api.practice.byHost({ host });
    return Response.json(
      { practiceId: practice.id },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isDefinedError(error)) return new Response(null, { status: 404 });
    throw error;
  }
}
