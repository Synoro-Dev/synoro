import { describe, expect, it } from "bun:test";
import { env } from "@synoro/config";

import { hostConfig, practiceHost } from "./hosts";

const config = {
  appHosts: new Set(["app.synoro.ru", "synoro.ru", "localhost"]),
};

describe("practiceHost", () => {
  it("leaves the app's own hosts alone", () => {
    for (const host of [null, "app.synoro.ru", "localhost:3000", "synoro.ru"]) {
      expect(practiceHost(host, config)).toBeUndefined();
    }
  });

  it("returns connected domains, without port", () => {
    expect(practiceHost("Zapis.Anna-Ivanova.ru:443", config)).toBe(
      "zapis.anna-ivanova.ru",
    );
  });
});

describe("hostConfig", () => {
  it("counts the main booking address as the app's, whatever the auth origins", () => {
    const mutable = env as {
      BOOKING_URL?: string;
      AUTH_TRUSTED_ORIGINS?: string;
    };
    const saved = { ...mutable };
    mutable.BOOKING_URL = "https://synoro.example";
    mutable.AUTH_TRUSTED_ORIGINS = "https://*.synoro.example";
    try {
      // As a practice host it would redirect to the app, and back: a loop.
      expect(practiceHost("synoro.example", hostConfig())).toBeUndefined();
      expect(practiceHost("anna-ivanova.ru", hostConfig())).toBe(
        "anna-ivanova.ru",
      );
    } finally {
      mutable.BOOKING_URL = saved.BOOKING_URL;
      mutable.AUTH_TRUSTED_ORIGINS = saved.AUTH_TRUSTED_ORIGINS;
    }
  });
});
