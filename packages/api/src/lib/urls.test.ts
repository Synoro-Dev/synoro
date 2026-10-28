import { describe, expect, test } from "bun:test";

import { practiceImageUrl } from "./urls";

describe("practiceImageUrl", () => {
  test("no photo, no url", () => {
    expect(practiceImageUrl("anna", null)).toBeNull();
  });

  test("versions the url with the timestamp of the stored key", () => {
    expect(
      practiceImageUrl("anna", "practices/p1/avatar-1730000000000.jpg"),
    ).toBe("/p/anna/avatar.jpg?v=1730000000000");
  });
});
