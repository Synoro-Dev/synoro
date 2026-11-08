import { describe, expect, test } from "bun:test";

import { seriesHeads } from "./series-heads";

const booking = (
  id: string,
  seriesId: string | null,
  terms: "refund" | "forfeit" | null,
) => ({
  id,
  seriesId,
  canCancel: terms !== null,
  lateCancel: terms === "forfeit",
});

describe("seriesHeads", () => {
  test("the nearest booking cancellable with the credit back", () => {
    expect(
      seriesHeads([booking("a", "s", "refund"), booking("b", "s", "refund")]),
    ).toEqual(new Set(["a"]));
  });

  test("skips a booking only a late cancel would take", () => {
    expect(
      seriesHeads([
        booking("late", "s", "forfeit"),
        booking("next", "s", "refund"),
      ]),
    ).toEqual(new Set(["next"]));
  });

  test("skips what can't be cancelled and single bookings", () => {
    expect(
      seriesHeads([
        booking("closed", "s", null),
        booking("single", null, "refund"),
        booking("next", "s", "refund"),
        booking("other", "t", "refund"),
      ]),
    ).toEqual(new Set(["next", "other"]));
  });
});
