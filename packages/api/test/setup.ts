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
process.env.POSTBOX_ACCESS_KEY_ID = "";
process.env.POSTBOX_SECRET_ACCESS_KEY = "";
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
// Metrika offline conversions are "configured"; tests stub fetch for it.
process.env.METRIKA_COUNTER_ID = "12345678";
process.env.METRIKA_OAUTH_TOKEN = "test-metrika-token";
// Both messenger bots are "configured"; tests stub fetch for their APIs.
process.env.TELEGRAM_BOT_TOKEN = "test-telegram-token";
process.env.TELEGRAM_BOT_USERNAME = "synoro_test_bot";
process.env.TELEGRAM_WEBHOOK_SECRET = "test-telegram-secret-0123";
process.env.TELEGRAM_API_URL = "https://telegram.test";
process.env.MAX_BOT_TOKEN = "test-max-token";
process.env.MAX_BOT_USERNAME = "synoro_max_bot";
process.env.MAX_WEBHOOK_SECRET = "test-max-secret-0123456";
process.env.MAX_API_URL = "https://max.test";
// The webhook script builds its address from APP_URL, and the sandbox has
// no webhooks: a local .env must not change either.
process.env.APP_URL = "http://localhost:3000";
process.env.TOCHKA_SANDBOX = "false";
