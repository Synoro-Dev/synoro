import { env } from "@synoro/config";
import type { MetadataRoute } from "next";
import { connection } from "next/server";

/**
 * The app host and practices' own domains. A crawl of the app's pages stays
 * allowed so robots see their `X-Robots-Tag` (`NOINDEX_SOURCE`). The demo stand
 * is closed: each visit without a cookie opens a session there.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  // The app and the demo differ by the pod's env, not by the build.
  await connection();
  if (env.DEMO_LOGIN_EMAIL) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return { rules: { userAgent: "*", allow: "/", disallow: "/api/" } };
}
