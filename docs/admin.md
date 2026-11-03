# Admin site (admin.synoro.ru)

`apps/admin` is a separate Next.js app for the Synoro team: an overview of the
platform, users, practices and «Про» payments. Read-only for now.

## Access

- Admins are `ADMIN_EMAILS` and accounts with the `admin` role (`isAdmin` in
  `@synoro/auth/roles`), the same rule as `adminProcedure`.
- Sign-in is by a code from the mail only. The admin's Better Auth handler
  (`/api/account` on the admin host) mails codes to admins only; anyone else
  gets the same "code sent" answer and no mail, so the admin host creates no
  accounts and doesn't reveal who is an admin. The handler serves only the
  code sign-in, sign-out and health routes (`src/auth/paths.ts`): password
  sign-in and sign-up, which would skip the code, answer 404.
- Users, sessions and the cookie are the app's: with `AUTH_COOKIE_DOMAIN`
  (`.synoro.ru`) a sign-in on either host counts on both. A signed-in
  non-admin lands on `/forbidden`.
- Every page calls `requireAdmin()` before reading data; `proxy.ts` is only
  the optimistic redirect to `/login`.

## API

Pages are Server Components calling `appRouter.admin` in-process
(`src/orpc/server.ts`). The admin host has no `/api/orpc`: nothing but the
admin procedures and the auth handler is reachable there. Procedures live in
`packages/api/src/routers/admin/` (`stats.overview`, `users.list`,
`users.byId`, `practices.list`, `payments.list`). Lists take `query`, `limit`,
`offset` and return `{ items, total }`; filters are URL params (`?q=`,
`?page=`, `?status=`), so a filtered list is a link.

## Running

```bash
bun dev:admin            # http://localhost:3001 (ADMIN_URL)
```

Locally cookies ignore the port, so a session from the app on :3000 works on
:3001 as well.

## Deploy

- Image `ghcr.io/synoro-dev/synoro-admin` from `apps/admin/Dockerfile`, built
  by the `admin` job of `.github/workflows/deploy.yml`; the deploy restarts
  `deploy/synoro-admin` after the app (whose pods run the migrations).
- `infra/synoro/admin.yaml`: Service, Deployment (`ADMIN_URL`, the rest from
  `synoro-config`) and the Traefik route for `admin.synoro.ru`.
- DNS: `A admin.synoro.ru` → the node. `admin` is in `RESERVED_SLUGS`, so no
  practice can take the subdomain.
