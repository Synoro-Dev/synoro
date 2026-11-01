import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { main } from "./tochka-webhook";

const URL_BASE = "https://tochka.test/uapi/webhook/v1.0/client-1";
const REGISTRATION = {
  webhooksList: ["acquiringInternetPayment"],
  url: "http://localhost:3000/api/billing/tochka",
};

let fetchMock: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;
let requests: { method: string; url: string; body: unknown }[];

beforeEach(() => {
  requests = [];
  fetchMock = spyOn(globalThis, "fetch").mockImplementation((async (
    input,
    init = {},
  ) => {
    requests.push({
      method: init.method ?? "GET",
      url: String(input),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return Response.json({ ok: true });
  }) as typeof fetch);
});
afterEach(() => fetchMock.mockRestore());

describe("billing:webhook", () => {
  it("registers, reads, tests and drops the payment webhook", async () => {
    for (const action of ["create", "show", "test", "delete"]) {
      expect(await main([action, "client-1"])).toBe(0);
    }
    expect(requests).toEqual([
      { method: "PUT", url: URL_BASE, body: REGISTRATION },
      { method: "GET", url: URL_BASE, body: undefined },
      {
        method: "POST",
        url: `${URL_BASE}/test_send`,
        body: { webhookType: "acquiringInternetPayment" },
      },
      { method: "DELETE", url: URL_BASE, body: REGISTRATION },
    ]);
  });

  it("takes another address", async () => {
    expect(
      await main(["create", "client-1", "https://app.synoro.ru/hook"]),
    ).toBe(0);
    expect(requests[0]?.body).toMatchObject({
      url: "https://app.synoro.ru/hook",
    });
  });

  it("refuses unknown actions and a missing client id", async () => {
    expect(await main([])).toBe(1);
    expect(await main(["create"])).toBe(1);
    expect(await main(["remove", "client-1"])).toBe(1);
    expect(requests).toHaveLength(0);
  });

  it("fails when the bank does", async () => {
    fetchMock.mockImplementation((async () =>
      Response.json(
        { message: "Webhook url is not available" },
        { status: 422 },
      )) as unknown as typeof fetch);
    expect(await main(["create", "client-1"])).toBe(1);
  });
});
