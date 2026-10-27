import { isDefinedError } from "@orpc/server";

import { api } from "~/orpc/server";

/**
 * Caddy on-demand TLS `ask` endpoint: 200 issues a certificate for
 * `?domain=`, anything else refuses. Only hosts that serve a practice page
 * (platform subdomains, verified domains) qualify, so strangers pointing
 * DNS here can't make us request certificates. See docs/custom-domains.md.
 */
export async function GET(request: Request) {
  const domain = new URL(request.url).searchParams.get("domain");
  if (!domain) return new Response(null, { status: 400 });

  try {
    await api.practice.byHost({ host: domain });
    return new Response(null, { status: 200 });
  } catch (error) {
    if (isDefinedError(error)) return new Response(null, { status: 404 });
    throw error;
  }
}
