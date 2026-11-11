import "server-only";

import { createRouterClient } from "@orpc/server";
import { appRouter, createORPCContext } from "@synoro/api";
import { headers } from "next/headers";
import { cache } from "react";

import { auth } from "~/auth/server";

const createServerContext = cache(async () => {
  const heads = new Headers(await headers());
  heads.set("x-orpc-source", "rsc");

  const session = await auth.api.getSession({ headers: heads });

  return createORPCContext({ headers: heads, session });
});

/**
 * The admin router only, called in-process from Server Components: the
 * admin site has no `/api/orpc` of its own, so nothing else is reachable
 * from this host.
 */
export const api = createRouterClient(
  { admin: appRouter.admin },
  { context: createServerContext },
).admin;
