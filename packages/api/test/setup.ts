/**
 * Preloaded by `bun test` (see bunfig.toml) before any test module, so the
 * env-reading modules (`@synoro/config`, `@synoro/db`, `adminProcedure`) see
 * deterministic values instead of whatever a local `.env` contains.
 *
 * Nothing connects to POSTGRES_URL: tests run procedures against PGlite.
 */
process.env.POSTGRES_URL = "postgres://test:test@localhost:5432/test";
process.env.ADMIN_EMAILS = "admin@test.local";
// Expected failures (rejected origins, payments) would otherwise log.
process.env.LOG_LEVEL = "silent";
process.env.PRACTICE_ROOT_DOMAIN = "pages.test";
process.env.CUSTOM_DOMAIN_CNAME = "domains.pages.test";
process.env.CUSTOM_DOMAIN_IP = "203.0.113.10";
// Emails (the visitor's booking link) go nowhere in tests.
process.env.EMAIL_SANDBOX_ENABLED = "false";
process.env.RESEND_API_KEY = "";
process.env.PAYMENTS_SECRET_KEY = "test-payments-secret-key-0123456789abcdef";
// A local .env with a PostHog key must not make tests send events.
delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
// The seeded demo shops (merchant id "demo-...") settle payments at once.
process.env.DEMO_LOGIN_EMAIL = "klyuev@example.com";
// Google Calendar is "configured"; tests stub fetch for its endpoints.
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
// «Про» billing through Точка is "configured"; tests stub fetch for it.
process.env.TOCHKA_API_TOKEN = "test-tochka-jwt";
process.env.TOCHKA_CUSTOMER_CODE = "300000001";
process.env.TOCHKA_TAX_SYSTEM = "usn_income";
process.env.TOCHKA_API_URL = "https://tochka.test/uapi";
