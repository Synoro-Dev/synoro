/**
 * Preloaded by `bun test` in this package (see bunfig.toml), before
 * `@synoro/config` reads the environment. Mirrors packages/api/test/setup.ts,
 * which the root bunfig preloads when tests run from the repo root.
 */
process.env.POSTGRES_URL = "postgres://test:test@localhost:5432/test";
process.env.ADMIN_EMAILS = "admin@test.local";
// Expected failures (rejected origins, payments) would otherwise log.
process.env.LOG_LEVEL = "silent";
