import { describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { RESERVED_SLUGS } from "@synoro/validators";
import { pathToRegexp } from "next/dist/compiled/path-to-regexp";

import { APP_ROOTS, EMBEDDABLE_SOURCE, SECURE_SOURCE } from "./page-routes";

const appDir = join(import.meta.dir, "..", "app");
const publicDir = join(import.meta.dir, "..", "..", "public");
const landingDir = join(import.meta.dir, "..", "..", "..", "web", "src", "app");

/** Static top-level segments of an App Router directory (groups unfolded). */
function topLevelSegments(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || entry.name.startsWith("[")) return [];
    if (entry.name.startsWith("(")) {
      return topLevelSegments(join(dir, entry.name));
    }
    return [entry.name];
  });
}

describe("top-level routes", () => {
  it("are all reserved, so a practice can't take their address", () => {
    for (const root of APP_ROOTS) expect(RESERVED_SLUGS.has(root)).toBe(true);
  });

  it("of the app are listed in APP_ROOTS", () => {
    const real = [
      ...topLevelSegments(appDir),
      // Public files served from the root, e.g. the demo practice's photo.
      ...readdirSync(publicDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    ];
    for (const segment of real) {
      expect(APP_ROOTS as readonly string[]).toContain(segment);
    }
  });

  it("of the landing are reserved", () => {
    for (const segment of topLevelSegments(landingDir)) {
      expect(RESERVED_SLUGS.has(segment)).toBe(true);
    }
  });
});

describe("header sources", () => {
  const embeddable = pathToRegexp(EMBEDDABLE_SOURCE);
  const secure = pathToRegexp(SECURE_SOURCE);

  it("let a booking page be framed and nothing else", () => {
    for (const path of ["/anna", "/anna-ivanova", "/klyuev"]) {
      expect(embeddable.test(path)).toBe(true);
      expect(secure.test(path)).toBe(false);
    }
    for (const path of [
      "/",
      "/practices",
      "/practices/abc/calendar",
      "/settings",
      "/bookings",
      "/auth/login",
      "/b/token",
      "/api/orpc/x",
      "/anna/avatar.jpg",
      "/an",
    ]) {
      expect(embeddable.test(path)).toBe(false);
      expect(secure.test(path)).toBe(true);
    }
  });
});
