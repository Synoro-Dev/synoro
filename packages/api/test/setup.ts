/**
 * Preloaded by `bun test` (see bunfig.toml) before any test module, so the
 * env-reading modules (`@synoro/config`, `@synoro/db`, `adminProcedure`) see
 * deterministic values instead of whatever a local `.env` contains.
 *
 * Nothing connects to POSTGRES_URL: tests run procedures against PGlite.
 */
process.env.POSTGRES_URL = "postgres://test:test@localhost:5432/test";
process.env.ADMIN_EMAILS = "admin@test.local";
process.env.LOG_LEVEL = "warn";
process.env.PRACTICE_ROOT_DOMAIN = "pages.test";
process.env.CUSTOM_DOMAIN_CNAME = "domains.pages.test";
process.env.CUSTOM_DOMAIN_IP = "203.0.113.10";
