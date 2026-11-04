import { describe, expect, it } from "bun:test";
import { env } from "@synoro/config";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";

import { appUrl, bookingRedirect } from "~/lib/hosts";
import { config, proxy } from "./proxy";

describe("proxy matcher", () => {
  const matches = (url: string) =>
    unstable_doesMiddlewareMatch({ config, url });

  it("runs for pages and the auth API only", () => {
    expect(matches("/")).toBe(true);
    expect(matches("/practices")).toBe(true);
    expect(matches("/api/account/get-session")).toBe(true);
  });

  it("skips the rest of the API and static files", () => {
    expect(matches("/api/orpc/booking/slots")).toBe(false);
    expect(matches("/api/domains/tls")).toBe(false);
    expect(matches("/_next/static/chunk.js")).toBe(false);
    expect(matches("/ingest/e/")).toBe(false);
    // Public photos: a signed-out visitor of /<slug> must load them.
    expect(matches("/demo/klyuev.jpg")).toBe(false);
    expect(matches("/demonstration")).toBe(true);
  });
});

const request = (path: string, host: string) =>
  new NextRequest(new URL(path, `http://${host}`), { headers: { host } });

const redirectTarget = (response: Response) => response.headers.get("location");

/**
 * Runs `fn` with DEMO_LOGIN_EMAIL set or unset. The root `bun test` also
 * preloads the API's test env, which turns the demo stand on.
 */
async function withDemoLogin(
  email: string | undefined,
  fn: () => Promise<void>,
) {
  const mutable = env as { DEMO_LOGIN_EMAIL?: string };
  const saved = mutable.DEMO_LOGIN_EMAIL;
  mutable.DEMO_LOGIN_EMAIL = email;
  try {
    await fn();
  } finally {
    mutable.DEMO_LOGIN_EMAIL = saved;
  }
}

describe("proxy on a practice host", () => {
  it("sends the auth API to the app host", async () => {
    const response = await proxy(
      request("/api/account/get-session?x=1", "zapis.anna-ivanova.ru"),
    );
    expect(redirectTarget(response)).toBe(
      new URL("/api/account/get-session?x=1", appUrl).href,
    );
  });

  it("rewrites / to the practice's booking page", async () => {
    const response = await proxy(request("/", "zapis.anna-ivanova.ru"));
    expect(response.headers.get("x-middleware-rewrite")).toContain(
      "/site/zapis.anna-ivanova.ru",
    );
  });
});

describe("proxy on the app host", () => {
  it("lets the auth API through without a session", async () => {
    const response = await proxy(
      request("/api/account/get-session", "localhost"),
    );
    expect(redirectTarget(response)).toBeNull();
  });

  it("still sends signed-out visitors of app pages to login", () =>
    withDemoLogin(undefined, async () => {
      const response = await proxy(request("/practices", "localhost"));
      expect(redirectTarget(response)).toContain("/auth/login");
    }));

  it("signs them in as the demo user on the demo stand", () =>
    withDemoLogin("demo@example.com", async () => {
      const response = await proxy(request("/practices", "localhost"));
      expect(redirectTarget(response)).toBe(
        new URL("/auth/demo?next=%2Fpractices", appUrl).href,
      );
    }));
});

describe("booking pages at /<slug>", () => {
  it("are open without a session", async () => {
    await withDemoLogin(undefined, async () => {
      const response = await proxy(request("/andrey-klyuev", "localhost"));
      expect(redirectTarget(response)).toBeNull();
      const photo = await proxy(
        request("/andrey-klyuev/avatar.jpg", "localhost"),
      );
      expect(redirectTarget(photo)).toBeNull();
    });
  });

  it("redirect the old /p/<slug> address, query kept", async () => {
    for (const host of ["localhost", "zapis.anna-ivanova.ru"]) {
      const response = await proxy(request("/p/andrey-klyuev?x=1", host));
      expect(response.status).toBe(308);
      expect(redirectTarget(response)).toBe(`http://${host}/andrey-klyuev?x=1`);
    }
    const photo = await proxy(
      request("/p/andrey-klyuev/avatar.jpg", "zapis.anna-ivanova.ru"),
    );
    expect(redirectTarget(photo)).toBe(
      "http://zapis.anna-ivanova.ru/andrey-klyuev/avatar.jpg",
    );
  });

  it("don't take over the app's own routes", () =>
    withDemoLogin(undefined, async () => {
      const response = await proxy(request("/settings", "localhost"));
      expect(redirectTarget(response)).toContain("/auth/login");
    }));
});

describe("bookingRedirect", () => {
  const page = { pathname: "/andrey-klyuev", search: "?x=1" };

  it("sends a booking page opened on another host to the main address", () => {
    expect(
      bookingRedirect({ ...page, host: "app.synoro.ru" }, "https://synoro.ru")
        ?.href,
    ).toBe("https://synoro.ru/andrey-klyuev?x=1");
  });

  it("does the same for the old /p/<slug> address", () => {
    expect(
      bookingRedirect(
        { pathname: "/p/andrey-klyuev", search: "", host: "app.synoro.ru" },
        "https://synoro.ru",
      )?.href,
    ).toBe("https://synoro.ru/andrey-klyuev");
  });

  it("leaves the main address, other paths and an unset address alone", () => {
    expect(
      bookingRedirect({ ...page, host: "synoro.ru" }, "https://synoro.ru"),
    ).toBeUndefined();
    expect(
      bookingRedirect(
        { pathname: "/bookings", search: "", host: "app.synoro.ru" },
        "https://synoro.ru",
      ),
    ).toBeUndefined();
    expect(
      bookingRedirect({ ...page, host: "app.synoro.ru" }, undefined),
    ).toBeUndefined();
  });
});
