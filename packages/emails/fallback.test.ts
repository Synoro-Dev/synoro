import { describe, expect, it } from "bun:test";

import { type Provider, sendWithFallback } from "./fallback";

function provider(name: string, error?: Error) {
  const sent: string[] = [];
  const p: Provider<string> = {
    name,
    send: async (message) => {
      if (error) throw error;
      sent.push(message);
    },
  };
  return { p, sent };
}

describe("sendWithFallback", () => {
  it("sends through the first provider only when it succeeds", async () => {
    const postbox = provider("postbox");
    const resend = provider("resend");
    const failures: string[] = [];

    await sendWithFallback([postbox.p, resend.p], "mail", (name) =>
      failures.push(name),
    );

    expect(postbox.sent).toEqual(["mail"]);
    expect(resend.sent).toEqual([]);
    expect(failures).toEqual([]);
  });

  it("falls back to the next provider when the first fails", async () => {
    const postbox = provider("postbox", new Error("boom"));
    const resend = provider("resend");
    const failures: [string, string | null][] = [];

    await sendWithFallback([postbox.p, resend.p], "mail", (name, next) =>
      failures.push([name, next]),
    );

    expect(resend.sent).toEqual(["mail"]);
    expect(failures).toEqual([["postbox", "resend"]]);
  });

  it("throws the last error when every provider fails", async () => {
    const postbox = provider("postbox", new Error("postbox down"));
    const resend = provider("resend", new Error("resend down"));
    const failures: [string, string | null][] = [];

    await expect(
      sendWithFallback([postbox.p, resend.p], "mail", (name, next) =>
        failures.push([name, next]),
      ),
    ).rejects.toThrow("resend down");
    expect(failures).toEqual([
      ["postbox", "resend"],
      ["resend", null],
    ]);
  });
});
