import { describe, expect, it } from "bun:test";

import { practiceHost } from "./hosts";

const config = {
  appHosts: new Set(["app.synoro.ru", "localhost"]),
  rootDomain: "synoro.ru",
};

describe("practiceHost", () => {
  it("leaves the app's own hosts alone", () => {
    for (const host of [
      null,
      "app.synoro.ru",
      "localhost:3000",
      "synoro.ru",
      "www.synoro.ru",
      "my-branch-acme.vercel.app",
    ]) {
      expect(practiceHost(host, config)).toBeUndefined();
    }
  });

  it("returns platform subdomains and connected domains, without port", () => {
    expect(practiceHost("anna.synoro.ru", config)).toBe("anna.synoro.ru");
    expect(practiceHost("Zapis.Anna-Psy.ru:443", config)).toBe(
      "zapis.anna-psy.ru",
    );
    expect(practiceHost("anna.localhost:3000", config)).toBe("anna.localhost");
  });
});
