import { afterEach, describe, expect, test } from "bun:test";

import { embedCode, reportFrameHeight } from "./embed";

const originals = [
  "window",
  "document",
  "ResizeObserver",
  "addEventListener",
].map(
  (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
);

function setGlobal(name: string, value: unknown) {
  Object.defineProperty(globalThis, name, { configurable: true, value });
}

afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

const pageOfHeight = (height: number) =>
  ({ getBoundingClientRect: () => ({ height }) }) as HTMLElement;

describe("embedCode", () => {
  test("frames the page and keeps a height for sites that strip scripts", () => {
    const code = embedCode("https://synoro.ru/anna");
    expect(code).toContain('<iframe data-synoro src="https://synoro.ru/anna"');
    expect(code).toContain("height:720px");
  });

  test("the script resizes only the frame the message came from", () => {
    const script = embedCode("https://synoro.ru/anna").match(
      /<script>(.*)<\/script>/,
    )?.[1];
    let listener: (event: unknown) => void = () => {};
    const own = { contentWindow: {}, style: { height: "720px" } };
    const other = { contentWindow: {}, style: { height: "720px" } };
    setGlobal("addEventListener", (_: string, fn: typeof listener) => {
      listener = fn;
    });
    setGlobal("document", { querySelectorAll: () => [own, other] });
    new Function(script ?? "")();

    listener({ source: own.contentWindow, data: { type: "other", height: 1 } });
    expect(own.style.height).toBe("720px");

    listener({
      source: own.contentWindow,
      data: { type: "synoro:height", height: 1200 },
    });
    expect(own.style.height).toBe("1200px");
    expect(other.style.height).toBe("720px");
  });
});

describe("reportFrameHeight", () => {
  test("does nothing outside a frame", () => {
    const frame = { parent: null as object | null };
    frame.parent = frame;
    setGlobal("window", frame);

    expect(reportFrameHeight(pageOfHeight(900))).toBeUndefined();
  });

  test("reports the page's height to the parent until cleaned up", () => {
    const messages: unknown[] = [];
    setGlobal("window", {
      parent: { postMessage: (message: unknown) => messages.push(message) },
    });
    const dataset: Record<string, string> = {};
    setGlobal("document", { documentElement: { dataset } });
    let notify = () => {};
    let disconnected = false;
    setGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe() {}
        disconnect() {
          disconnected = true;
        }
      },
    );

    const cleanup = reportFrameHeight(pageOfHeight(900.5));
    expect(dataset.framed).toBe("");

    notify();
    expect(messages).toEqual([{ type: "synoro:height", height: 901 }]);

    cleanup?.();
    expect(disconnected).toBe(true);
    expect(dataset.framed).toBeUndefined();
  });
});
