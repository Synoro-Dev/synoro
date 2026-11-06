import { describe, expect, it } from "bun:test";

import { practiceHost } from "./hosts";

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
