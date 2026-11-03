# CLAUDE.md

Bun + Turborepo monorepo: a Next.js 16 app with an end-to-end typed oRPC API,
Drizzle ORM (Postgres), Better Auth, React Email, and shadcn/ui.

## Commands

Run from the repo root. **Use `bun run <script>` for `build` and `test`**: bare
`bun build` / `bun test` invoke Bun's built-in bundler / test runner, not the
package scripts.

```bash
bun dev                  # Next.js app on :3000 (turbo watch, @synoro/app + deps)
bun dev:admin            # admin site (apps/admin) on :3001
bun jobs:dev             # Hatchet worker (watch); needs HATCHET_CLIENT_TOKEN
bun run build            # turbo build of everything
bun typecheck            # tsc across all workspaces (needs ^build)
bun check                # biome lint + format check
bun check:fix            # biome auto-fix (lint + format)
bun test                 # Bun's test runner over all *.test.ts (fast)
bun test packages/api    # single package / file
bun lint:ws              # sherif: workspace package.json consistency
bun lint:deps            # knip: unused files / deps, unlisted deps
bun e2e                  # Playwright (apps/app/e2e); needs Postgres + db:migrate
```

Scope turbo to one workspace with `-F`: `bun turbo typecheck -F @synoro/api`.

Database / auth (need `.env` with `POSTGRES_URL`; local services via
`docker compose up -d` — Postgres :5432, MinIO :9001/:9002, inbucket :9000):

```bash
bun db:generate          # schema diff → new SQL migration in packages/db/migrations
bun db:migrate           # apply pending migrations (local, CI e2e, production);
                         # src/scripts/migrate.ts, not drizzle-kit (prints DB errors)
bun db:check             # offline consistency check of migrations (CI runs it)
bun db:baseline          # one-off: adopt a DB created by db:push, then db:migrate
bun db:push              # throwaway prototyping only — never on shared DBs
bun auth:generate        # regenerate Better Auth schema from config
```

## Before declaring work done

`bun check:fix && bun lint:deps && bun typecheck && bun test` — the same
gates as CI (`.github/workflows/ci.yml`: biome, sherif, knip, then
`turbo run build typecheck test --affected`; a separate job migrates a fresh
Postgres and runs Playwright). Schema edits also need `bun db:generate` —
CI fails if `src/schema` has changes with no committed migration.

## Layout

```
apps/app            Next.js 16 App Router (RSC). Serves the API itself.
  src/app/api/orpc  oRPC HTTP handler    src/app/api/account  Better Auth handler
  src/orpc/server.ts  RSC caller `api` (server-only)
  src/orpc/react.tsx  browser client + `orpc` TanStack Query utils
  src/proxy.ts      optimistic auth redirect (Next 16 "proxy", ex-middleware)
apps/admin          admin.synoro.ru (Next.js): RSC calls `appRouter.admin` in-process
apps/web            landing on synoro.ru
packages/api        oRPC procedures + router (`appRouter`)
packages/auth       Better Auth `initAuth()` — single source of auth config
packages/config     @t3-oss/env-core `env`, structured `logger`, `paths`
packages/db         Drizzle schema, node-postgres client
packages/emails     React Email templates + send (Yandex Postbox, Resend fallback)
packages/storage    S3 helpers (MinIO locally)
packages/jobs       Hatchet tasks + worker (background jobs, emails)
packages/ui         shadcn/ui components (Base UI), `cn`
packages/validators shared Zod form schemas (+ bun:test tests)
tooling/*           shared tsconfig, tailwind theme, GitHub Action setup
```

Packages that compile to `dist/` (`config`, `emails`, `storage`) must be built
before dependents typecheck — turbo's `^build` handles this; if you edit them
and run `tsc` by hand, build them first.

## Conventions

- TypeScript strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`:
  use `import type` for type-only imports (Biome enforces `useImportType`).
- Biome style: 2 spaces, double quotes, semicolons, trailing commas, 80 cols.
  `packages/ui` and `tooling` are excluded from Biome — don't reformat them.
- Files kebab-case; components PascalCase; functions camelCase.
- Internal imports use workspace names (`@synoro/db`, `@synoro/ui`); inside
  `apps/app` use the `~/` alias for `src/`.
- Server Components by default; add `"use client"` only when needed.
- Next config: **Cache Components** (PPR), `typedRoutes`, `reactCompiler`.
  Request-time reads (`getSession()`, `api.*` from `~/orpc/server`,
  `headers()`, `cookies()`) go in an async component inside `<Suspense>` —
  never at a layout's top level (see `(dashboard)/layout.tsx`,
  `settings/page.tsx`); the build fails otherwise. No route segment configs
  (`dynamic`, `runtime`, `revalidate`): cache with `"use cache"`. Remove
  `dynamic = "force-dynamic"`; `dynamic = "force-static"` requires a separate
  migration. Replace `revalidate` with `cacheLife` inside a `"use cache"`
  scope. `runtime = "edge"` is unsupported; remove it and use the default
  Node.js runtime. Links and `router.push` are route-checked (`bun typecheck`
  runs `next typegen`). No `Math.random()`/`Date.now()` in render of
  prerendered components.
  Don't hand-write `useMemo`/`useCallback` for performance.
- Env vars: add to the Zod schema in `packages/config/src/env.ts` (or
  `apps/app/src/env.ts` for app-only / `NEXT_PUBLIC_*`), to `runtimeEnv`, to
  `.env.example`, and to `globalEnv` in `turbo.json` if it affects builds.
  Never read `process.env` directly in new code.
- Log with `logger` from `@synoro/config`, not `console.log`. Lines inside a
  request carry `trace_id` / `span_id` from the active OpenTelemetry span.
  Tracing is wired in `apps/app/src/instrumentation.ts` (`@vercel/otel` +
  `ORPCInstrumentation` from `@orpc/opentelemetry`, the v2 beta of
  `@orpc/otel`): every oRPC call gets spans under Next's request span. Set
  `OTEL_EXPORTER_OTLP_ENDPOINT` to ship them.
- Conventional Commits: `feat(api): …`, `fix(db): …`.

## Key patterns

- **New API procedure**: one file per procedure under
  `packages/api/src/routers/<domain>/`, built from `publicProcedure`,
  `protectedProcedure`, or `adminProcedure` (`packages/api/src/orpc.ts`),
  exported through the domain `index.ts` and wired into
  `routers/index.ts`. Clients get types automatically — no codegen.
  Expected failures: `.errors({ NOT_FOUND: { message } })` + `throw
  errors.NOT_FOUND()`, narrowed on the client with `isDefinedError`; not
  `new ORPCError(...)`, which arrives untyped. Use the `/new-api-endpoint` skill.
- **Calling the API**: in RSC `await api.post.list({...})` from
  `~/orpc/server`; in client components
  `useQuery(orpc.post.list.queryOptions({ input }))` from `~/orpc/react`.
- **Schema change**: edit `packages/db/src/schema/<domain>/`, export from the
  domain `index.ts`, then `bun db:generate`, review and commit the SQL in
  `packages/db/migrations/`, and `bun db:migrate`. Use the `/db-change`
  skill. Columns are camelCase in TS, `casing: "snake_case"` in SQL.
  Generated migrations may be hand-edited (e.g. `IF NOT EXISTS`, data
  backfills); never edit or reorder ones already applied anywhere shared.
  PGlite tests (`createTestDb`) run the migrations, not the schema.
- **Admin access**: the `admin` role from Better Auth's admin plugin
  (`authClient.admin.setRole`, bans, impersonation under
  `/api/account/admin/*`). `ADMIN_EMAILS` is the bootstrap list: those accounts
  get the role on sign-up / sign-in and pass `adminProcedure` once the
  address is verified (a code sign-in verifies it). Role
  checks live in `@synoro/auth/roles` (no better-auth import — usable from
  `@synoro/api`).
  The admin site is its own app (`docs/admin.md`): `apps/admin`, procedures in
  `routers/admin/`, every page starts with `requireAdmin()`; sign-in codes are
  mailed to admins only.
- **Background jobs** (Hatchet, `packages/jobs`): declare tasks in
  `src/workflows/` and register them in `src/worker.ts`. App code imports
  only `@synoro/jobs` (e.g. `dispatchEmail`), never `@synoro/jobs/workflows` at
  module level: creating the Hatchet client throws without
  HATCHET_CLIENT_TOKEN. Without a token, `@synoro/jobs` runs the work inline.
  Task inputs must be JSON — emails travel as `TemplateEmail`
  (`template` + `props`, see `packages/emails/templates.ts`).
- **Booking without sign-in** (`docs/guest-booking.md`): `booking.reserve`
  holds a time for 15 min (`bookings.hold_until`), opens the payment and mails
  `/b/<token>`; `settlePayment` confirms the booking in the same statement as
  the credit. Phone (`users.phone`, E.164 via `phoneSchema`) is required in
  every booking form. `BOOKING_URL` (https://synoro.ru) is the main address of
  `/p/<slug>`; build links from `packages/api/src/lib/urls.ts`.
- **Free intro and phone booking** (`docs/free-booking.md`): the `kind = free`
  booking, `practices.intro_minutes` long (30/45/60/90, starts on the half
  hour). Visitors book it themselves via `booking.bookIntro` when
  `practices.free_booking_enabled` is on — once per person (member or
  phone); staff book guests with `bookFree`. `booking.windows` +
  `/practices/<id>/windows` show free time for booking a caller.
- **«Про» billing** (`docs/billing.md`): 149 ₽/month or 1490 ₽/year, a
  14-day trial from the first practice (`subscriptions`). Specialists pay
  Synoro through Точка Банк payment links (`TOCHKA_*` env); gate paid
  features with `hasPro` / `payableAccount`. Prices: `PRO_PRICES` in
  `@synoro/validators` and `apps/web/src/lib/pricing.ts` — keep in sync.
  Auto-renewal is opt-in (checkbox → Точка subscription `recurring: true`,
  `subscription_autorenewals`): the `billing-renewals` cron in
  `@synoro/jobs/billing-renewal` charges it before `paid_until`; shared
  settle code lives in `@synoro/jobs/billing`. Subscription payments are
  refunded in the bank's cabinet, then `billing.refund { recorded: true }`.
  `TOCHKA_SANDBOX=true` runs the flow against Точка's official sandbox (built-in
  test credentials; its links can't be paid, so the billing page confirms with
  `billing.sandboxPay`); never on a deployment with real customers.
- **Own client messages («Про»)** (`docs/reminders.md`): `workflows` rules
  (owner edits them at `/practices/<id>/messages`, `workflow.*` router, texts and
  ranges in `@synoro/validators/workflow`); the Hatchet cron `workflow-messages`
  (`packages/jobs/src/workflow-messages.ts`) mails them once per case through
  `claimNotice` (`notice-claims.ts`, keys `wf:<rule>:…` in `sent_notices`), only
  while the owner has `hasPro`.
- **Booking questionnaire («Про»)** (`docs/booking-questions.md`): up to 10
  questions in `practices.booking_questions` (owner edits them on the booking
  page settings, `question.*` router, schema and `checkBookingAnswers` in
  `@synoro/validators/booking-questions`). Clients answer in `booking.book` /
  `bookSeries` / `reserve` (`ANSWERS_INVALID` per question id); answers are
  kept with the question's wording in `bookings.answers` and shown to staff in
  `booking.calendar`. Not asked without `hasPro` (`askedQuestions`).
- **Booking page look («Про»)** (`docs/booking-theme.md`): accent, headings'
  font, corners, backdrop and an «about» line in `practices.booking_theme`
  (owner and admins, `practice.theme` / `setTheme`; presets and
  `readBookingTheme` in `@synoro/validators/booking-theme`). Presets only
  re-tint theme tokens via `data-booking-*` (`apps/app/src/app/booking-theme.css`)
  — never restyle components for a theme. Default look without `hasPro`.
- **Practice analytics («Про»)** (`docs/analytics.md`): `analytics.overview`
  (owner only, `report: null` without «Про») — meetings, no-shows, online
  revenue, clients and busy hours for 30/90/365 days against the stretch before;
  queries in `routers/analytics/stats.ts`, page `/practices/<id>/analytics`.
  Revenue is online payments only (manual packages have no amount).
- **Messenger notices («Про»)** (`docs/reminders.md`, «Мессенджеры»):
  Synoro bots in Telegram and MAX (`TELEGRAM_*` / `MAX_*` env, webhooks
  `/api/telegram`, `/api/max`, registered by `bun messenger:webhooks`). A
  user links one chat (`messenger_chats`) via `messenger.link` → one-time
  start code. Notice senders in `packages/jobs` take a `Deliver` with a
  recipient (`userId`, `practiceId`); the default `noticeSender(db)` sends to
  the chat when the practice owner has «Про», else mail; a blocked bot or
  the last failed retry of `send-messenger` falls back to mail. Clients
  cancel from the notice's «Отменить запись» button (action strings in
  `jobs/src/messenger/actions.ts`, checked by `cancelBookingAs` — the same
  rules as `booking.cancel`). Staff get tomorrow's bookings at 20:00
  (`staff-agenda` cron); the owner turns notices off per practice
  (`remind_clients`, `notify_staff`, `daily_agenda`, `practice.setNotifications`).
- **Video meetings** (`docs/guest-booking.md`): `practices.video_url` (owner)
  and `bookings.meeting_url` (staff) — the link in force is
  `meeting_url ?? video_url`, `https` only (`normalizeVideoUrl`). Clients see
  it only on confirmed bookings (`booking.guest` / `booking.mine`) and get it by
  mail (`booking-notice`) via `@synoro/jobs/booking-video`; reminders are the
  `booking-reminders` Hatchet workflow. Never expose the link in public
  procedures (`slots`, `bySlug`).
- **Analytics (PostHog)**: `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` (+ `_HOST`, default EU
  cloud); unset — everything is a no-op. Browser: `src/instrumentation-client.ts`
  in `apps/app` and `apps/web`, events via the `/ingest` rewrite in
  `next.config.ts` (excluded from `proxy.ts`). Session replay is on in both apps, inputs masked, text
  readable (also in the app and on `demo.*`). Identify
  by user id only (`~/lib/analytics`), never email/name/phone. Server events:
  `track()` in `packages/api/src/lib/analytics.ts` (add the name to
  `ServerEvent`). The key is a build arg (Dockerfiles, deploy.yml) _and_ must
  be in the pod env for server events.
- **Yandex Direct, paid per annual customer** (`docs/direct.md`): the landing
  remembers `?yclid=` in cookie `ad_yclid` (`.synoro.ru`); `billing.checkout`
  stores it and Metrika's `_ym_uid` on `subscription_payments`; the
  `metrika-conversions` cron (`@synoro/jobs/metrika`) uploads the user's first
  paid year as the offline conversion `paid_year` (once per payment, claim in
  `sent_notices`). Needs `METRIKA_COUNTER_ID` + `METRIKA_OAUTH_TOKEN` and the
  goal in Metrika; the landing needs the repo variable
  `NEXT_PUBLIC_YANDEX_METRIKA_ID` (same counter as the app's `COUNTER_ID`).
- **Demo stand** (`docs/demo.md`): `bun db:seed` / the nightly reset fill one
  practice with every role and two months of payments; `DEMO_LOGIN_EMAIL`
  enables `/auth/demo?as=<key>` (roster in `@synoro/auth/demo`) and makes
  payments to `demo-…` shops settle instantly. Keep the seed consistent:
  balance = sum of `credit_entries`, one purchase entry per paid payment.
- `@synoro/api` stays free of the concrete `Auth` type: callers resolve the
  session via `auth.api.getSession` and pass it into `createORPCContext`.
- **Testing procedures**: `call(procedure, input, { context })` from
  `@orpc/server` against an in-memory PGlite DB — `setupTestApi()` and
  `createSession()` in `packages/api/test/helpers.ts` (built on
  `createTestDb()` from `@synoro/db/testing`). See `routers/post/post.test.ts`.
  `packages/api/test/setup.ts` is preloaded via `bunfig.toml` (root and
  package) to pin env before modules read it.

## Gotchas

- `.env` lives at the repo root; package scripts load it with
  `bun --env-file=../../.env`. Never commit it or print its values.
- `src/proxy.ts` is only an optimistic redirect — always enforce auth in the
  procedure / page (`protectedProcedure`, session check).
- oRPC is pinned to `2.0.0-beta.*` (npm `beta` tag; plain installs get v1).
  v2 docs: https://orpc.dev. `RPCLink` takes `origin` + path-only `url`, and
  `RPCHandler` rejects GET by default. v1 clients can't talk to a v2 server.
- `README.md` mentions `apps/app-server` and `apps/docs`; they are not in this
  repo. `CONTRIBUTING.md` still says tRPC in places — the API is oRPC.
- Windows dev machine is common here: prefer cross-platform scripts (Bun/TS)
  over bash-only one-liners in package scripts and hooks.
- Bun uses the **isolated** linker (`bunfig.toml`): a package can only import
  what its own `package.json` declares. "Cannot find module" after adding an
  import means a missing dependency, not a broken install. PostCSS plugins
  resolve from `apps/app`, so `@tailwindcss/postcss` is declared there too.
- Test files (`*.test.ts`) are excluded from package `tsconfig`s, so
  `bun typecheck` does not cover them.
