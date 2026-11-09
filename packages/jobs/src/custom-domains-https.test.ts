import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server, type ServerResponse } from "node:https";
import type { AddressInfo, Socket } from "node:net";

import { TEST_CA, TEST_CERT, TEST_KEY } from "../test/fixtures/tls";
import { DOMAIN_CHECK_PATH, probeHttps } from "./custom-domains";

/**
 * The readiness probe against a real https server, with a certificate for
 * `anna.test` signed by a CA made for this test (`test/fixtures/tls.ts`).
 */
const ca = TEST_CA;

const PRACTICE = "11111111-1111-4111-8111-111111111111";

/** What the server does for the next request. */
let answer: (response: ServerResponse) => void;
const seen: { host?: string; path?: string }[] = [];

let server: Server;
let port: number;
/** Open connections: a test that leaves one hanging can't stall the rest. */
const sockets = new Set<Socket>();
/** Requests whose connection the probe has closed. */
let closed = 0;

beforeAll(async () => {
  server = createServer(
    { key: TEST_KEY, cert: TEST_CERT },
    (request, response) => {
      seen.push({ host: request.headers.host, path: request.url });
      response.on("close", () => closed++);
      answer(response);
    },
  );
  server.on("secureConnection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  for (const socket of sockets) socket.destroy();
  server.close();
});

const json = (body: unknown) => (response: ServerResponse) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

function probe(
  options: {
    host?: string;
    trust?: boolean;
    practiceId?: string;
    timeoutMs?: number;
  } = {},
) {
  return probeHttps({
    host: options.host ?? "anna.test",
    // Our entry point: the address, never the host's own DNS.
    via: "127.0.0.1",
    practiceId: options.practiceId ?? PRACTICE,
    port,
    ca: options.trust === false ? undefined : ca,
    timeoutMs: options.timeoutMs,
  });
}

/** Waits until the server has seen the probe close the connection. */
async function closedBy(count: number) {
  for (let i = 0; i < 100 && closed < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return closed >= count;
}

describe("probeHttps", () => {
  test("ready: trusted certificate and the expected practice", async () => {
    answer = json({ practiceId: PRACTICE });
    seen.length = 0;
    expect(await probe()).toBe(true);
    // Asked through the entry point, as the domain, at the check route.
    expect(seen).toEqual([{ host: "anna.test", path: DOMAIN_CHECK_PATH }]);
  });

  test("another practice answering is not ready", async () => {
    answer = json({ practiceId: "22222222-2222-4222-8222-222222222222" });
    expect(await probe()).toBe(false);
  });

  test("a certificate nobody trusts (Traefik's default) is not ready", async () => {
    answer = json({ practiceId: PRACTICE });
    expect(await probe({ trust: false })).toBe(false);
  });

  test("a certificate for another host is not ready", async () => {
    answer = json({ practiceId: PRACTICE });
    expect(await probe({ host: "boris.test" })).toBe(false);
  });

  test("404 (no such domain) and 502 (no app behind the route)", async () => {
    for (const status of [404, 502]) {
      answer = (response) => {
        response.writeHead(status);
        response.end();
      };
      expect(await probe()).toBe(false);
    }
  });

  test("a page instead of the check's JSON", async () => {
    answer = (response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>Запись</title>");
    };
    expect(await probe()).toBe(false);
  });

  test("a body cut off after the response started", async () => {
    answer = (response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write(`{"practiceId":"${PRACTICE}"`);
      setTimeout(() => response.socket?.destroy(), 20);
    };
    expect(await probe()).toBe(false);
  });

  test("an oversized body, even if it is valid JSON", async () => {
    answer = json({ practiceId: PRACTICE, padding: "x".repeat(4_096) });
    expect(await probe()).toBe(false);
  });

  test("a server that never answers: gives up and closes", async () => {
    answer = () => {};
    const before = closed;
    const started = Date.now();
    expect(await probe({ timeoutMs: 300 })).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await closedBy(before + 1)).toBe(true);
  });

  test("a body trickling in: the deadline holds for the whole exchange", async () => {
    // A byte every 50 ms never leaves the socket idle long enough to time out.
    answer = (response) => {
      response.writeHead(200, { "content-type": "application/json" });
      const drip = setInterval(() => response.write(" "), 50);
      response.on("close", () => clearInterval(drip));
    };
    const before = closed;
    const started = Date.now();
    expect(await probe({ timeoutMs: 300 })).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await closedBy(before + 1)).toBe(true);
  });

  test("nothing listening", async () => {
    expect(
      await probeHttps({
        host: "anna.test",
        via: "127.0.0.1",
        practiceId: PRACTICE,
        port: 1,
        ca,
      }),
    ).toBe(false);
  });
});
