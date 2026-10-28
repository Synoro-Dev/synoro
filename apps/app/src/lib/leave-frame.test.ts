import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import { leaveFrame } from "./leave-frame";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const confirmationUrl = "https://payments.example/checkout/existing-payment";

function setWindow(frame: object) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: frame,
  });
}

afterEach(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

describe("leaveFrame", () => {
  test("opens payment in the top window and leaves the frame in place", () => {
    const topLocation = { href: "https://site.example" };
    const frameLocation = { href: "https://booking.example/p/practice" };
    setWindow({ top: { location: topLocation }, location: frameLocation });

    leaveFrame(confirmationUrl);

    expect(topLocation.href).toBe(confirmationUrl);
    expect(frameLocation.href).toBe("https://booking.example/p/practice");
  });

  test("opens payment in the current window outside an iframe", () => {
    const frame = { location: { href: "" }, top: null as object | null };
    frame.top = frame;
    setWindow(frame);

    leaveFrame(confirmationUrl);

    expect(frame.location.href).toBe(confirmationUrl);
  });

  test("uses the current window when top is unavailable", () => {
    const location = { href: "" };
    setWindow({ top: null, location });

    leaveFrame(confirmationUrl);

    expect(location.href).toBe(confirmationUrl);
  });

  test("keeps a successful payment available when sandbox navigation is denied", async () => {
    setWindow({
      top: {
        get location() {
          throw new DOMException("Top navigation is blocked", "SecurityError");
        },
      },
    });
    const client = new QueryClient();
    const payment = { confirmationUrl };
    const mutation = client.getMutationCache().build(client, {
      mutationFn: async () => payment,
      onSuccess: (data) => leaveFrame(data.confirmationUrl),
    });

    await mutation.execute(undefined);

    expect(mutation.state.status).toBe("success");
    expect(mutation.state.data).toEqual(payment);
    client.clear();
  });

  test("propagates unexpected errors", () => {
    const error = new TypeError("Unexpected navigation failure");
    setWindow({
      top: {
        get location() {
          throw error;
        },
      },
    });

    expect(() => leaveFrame(confirmationUrl)).toThrow(error);
  });
});
