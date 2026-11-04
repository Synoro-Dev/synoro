import { describe, expect, it } from "bun:test";

import { deviceLabel, locationLabel, methodLabel } from "./sign-ins";

describe("sign-in labels", () => {
  it("names the browser and the system", () => {
    expect(
      deviceLabel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome · Windows");
    expect(
      deviceLabel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 YaBrowser/24.10 Safari/537.36",
      ),
    ).toBe("Яндекс Браузер · Windows");
    expect(
      deviceLabel(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari · iOS");
    expect(deviceLabel(null)).toBe("—");
    expect(deviceLabel("curl/8.0")).toBe("—");
  });

  it("writes the place in Russian", () => {
    expect(
      locationLabel({ city: "Москва", region: "Москва", country: "RU" }),
    ).toBe("Москва, Россия");
    expect(locationLabel({ city: null, region: null, country: "KZ" })).toBe(
      "Казахстан",
    );
    expect(
      locationLabel({ city: null, region: null, country: null }),
    ).toBeNull();
  });

  it("explains known endpoints and keeps unknown ones", () => {
    expect(methodLabel("/sign-in/email-otp")).toBe("Код из почты");
    expect(methodLabel("/something")).toBe("/something");
    expect(methodLabel(null)).toBe("—");
  });
});
