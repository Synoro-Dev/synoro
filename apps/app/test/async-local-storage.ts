/**
 * Preloaded by `bun test` (see bunfig.toml). Next reads
 * `globalThis.AsyncLocalStorage` when it is first imported and otherwise falls
 * back to a stub whose `run()` throws. Bun doesn't set it (Next's own server
 * does), so once proxy.test.ts imports `next/server` that stub leaks into the
 * OpenTelemetry context that `logger` reads, and every log line written by
 * tests in the same `bun test` process throws.
 */
import { AsyncLocalStorage } from "node:async_hooks";

Object.assign(globalThis, { AsyncLocalStorage });
