import { isAllowedAuthPath } from "~/auth/paths";
import { auth } from "~/auth/server";

async function handle(request: Request) {
  if (!isAllowedAuthPath(new URL(request.url).pathname)) {
    return new Response("Not found", { status: 404 });
  }
  return auth.handler(request);
}

export const GET = handle;
export const POST = handle;
