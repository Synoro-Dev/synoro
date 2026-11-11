import { describe, expect, it } from "bun:test";

import { tbankStatus, tbankToken, verifyTbankToken } from "./tbank";

describe("tbankToken", () => {
  it("matches the example from the Т-Банк docs", () => {
    const token = tbankToken(
      {
        TerminalKey: "MerchantTerminalKey",
        Amount: 19200,
        OrderId: "00000",
        Description: "Подарочная карта на 1000 рублей",
        DATA: { Phone: "+71234567890" },
        Receipt: { Items: [] },
      },
      "11111111111111",
    );
    expect(token).toBe(
      "72dd466f8ace0a37a1f740ce5fb78101712bc0665d91a8108c7c8a0ccd426db2",
    );
  });

  it("verifies notifications, booleans included", () => {
    const body: Record<string, unknown> = {
      TerminalKey: "1700000000000DEMO",
      OrderId: "order",
      Success: true,
      Status: "CONFIRMED",
      PaymentId: 8_000_000,
      ErrorCode: "0",
      Amount: 300_000,
    };
    body.Token = tbankToken(body, "password");

    expect(verifyTbankToken(body, "password")).toBe(true);
    expect(verifyTbankToken(body, "other")).toBe(false);
    expect(verifyTbankToken({ ...body, Amount: 1 }, "password")).toBe(false);
  });
});

describe("tbankStatus", () => {
  it("credits only CONFIRMED and closes failed payments", () => {
    expect(tbankStatus("CONFIRMED")).toBe("succeeded");
    expect(tbankStatus("AUTHORIZED")).toBe("pending");
    expect(tbankStatus("REJECTED")).toBe("canceled");
    expect(tbankStatus("DEADLINE_EXPIRED")).toBe("canceled");
  });
});
