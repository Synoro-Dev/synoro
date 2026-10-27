/**
 * Preloaded by `bun test` (see bunfig.toml) before any test module, so
 * `@synoro/config` reads deterministic values: in CI its validation (and
 * with it the defaults) is skipped, which left APP_URL undefined.
 */
process.env.APP_URL = "http://localhost:3000";
process.env.PRACTICE_ROOT_DOMAIN = "localhost";
