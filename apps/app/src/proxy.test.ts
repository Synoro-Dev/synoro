import { describe, expect, it } from "bun:test";
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
    expect(matches("/api/auth/get-session")).toBe(true);
  });

  it("skips the rest of the API and static files", () => {
    expect(matches("/api/orpc/booking/slots")).toBe(false);
    expect(matches("/api/domains/tls")).toBe(false);
    expect(matches("/_next/static/chunk.js")).toBe(false);
  });
});

const request = (path: string, host: string) =>
  new NextRequest(new URL(path, `http://${host}`), { headers: { host } });

const redirectTarget = (response: Response) => response.headers.get("location");

describe("proxy on a practice host", () => {
  it("sends the auth API to the app host", async () => {
    const response = await proxy(
      request("/api/auth/get-session?x=1", "zapis.anna-ivanova.ru"),
    );
    expect(redirectTarget(response)).toBe(
      new URL("/api/auth/get-session?x=1", appUrl).href,
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
    const response = await proxy(request("/api/auth/get-session", "localhost"));
    expect(redirectTarget(response)).toBeNull();
  });

  it("still sends signed-out visitors of app pages to login", async () => {
    const response = await proxy(request("/practices", "localhost"));
    expect(redirectTarget(response)).toContain("/auth/login");
  });
});

describe("bookingRedirect", () => {
  const page = { pathname: "/p/andrey-klyuev", search: "?x=1" };

  it("sends a booking page opened on another host to the main address", () => {
    expect(
      bookingRedirect({ ...page, host: "app.synoro.ru" }, "https://synoro.ru")
        ?.href,
    ).toBe("https://synoro.ru/p/andrey-klyuev?x=1");
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
