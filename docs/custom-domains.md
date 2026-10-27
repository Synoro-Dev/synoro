# Practice pages on their own domains

A practice's booking page opens at three kinds of address:

| Address                                            | Setup                                                 |
| -------------------------------------------------- | ----------------------------------------------------- |
| `https://app.example.com/p/anna`                   | always                                                |
| `https://anna.example.com`                         | `PRACTICE_ROOT_DOMAIN=example.com` + wildcard DNS/TLS |
| `https://anna-psy.ru`, `https://zapis.anna-psy.ru` | owner connects it under **Практика → Домен**          |

## How it works

- `apps/app/src/proxy.ts` looks at `Host`. Anything that isn't the app's own
  host (`APP_URL`, `NEXT_PUBLIC_APP_URL`, Vercel URLs, the bare root and
  `www.` of `PRACTICE_ROOT_DOMAIN`) is a practice host: `/` is rewritten to
  `/site/<host>`, `/_next/*` and files are served as is, every other path
  redirects to the same path on `APP_URL`.
- `/site/[host]` resolves the practice with `practice.byHost`: `<slug>.<root>`
  by slug, anything else by an **active** row in `practice_domains`.
- Sign-in and the cabinet stay on the app host: the session cookie is never
  set for a specialist's domain. On a practice host the page is read-only for
  visitors; «Войти и записаться» leads to `/p/<slug>` on the app host. With
  `AUTH_COOKIE_DOMAIN=.example.com` the session also reaches platform
  subdomains (`anna.example.com`), so signed-in clients book right there.
- Exact `AUTH_TRUSTED_ORIGINS` (e.g. `https://example.com`) count as app hosts
  and can't be claimed; wildcard patterns don't, since they'd cover practice
  subdomains too.
- Connecting a domain (`domain.connect`) stores it as `pending` with a random
  token. `domain.verify` looks up `TXT _booking-verification.<host>`; once the
  token is there the domain becomes `active`. Without that step anyone could
  claim a domain they don't control. The CNAME/A check only tells the owner
  whether traffic already reaches us. A pending reservation lasts 24 hours
  from connection (or hostname replacement); after expiry, connecting the
  hostname again issues a fresh token and allows another practice to claim it.
  Active domains do not expire.

## Environment

```bash
PRACTICE_ROOT_DOMAIN=example.com        # anna.example.com; unset = no subdomains
CUSTOM_DOMAIN_CNAME=domains.example.com # what subdomains CNAME to
CUSTOM_DOMAIN_IP=203.0.113.10           # what apex domains point an A record to
```

Locally `PRACTICE_ROOT_DOMAIN=localhost` works without DNS:
`http://anna.localhost:3000` (browsers resolve `*.localhost` to loopback).

## Hosting

Specialists' domains need TLS certificates issued on demand.

### Self-hosted (Docker, `output: "standalone"`) behind Caddy

```caddyfile
{
  on_demand_tls {
    # 200 only for platform subdomains and verified domains.
    ask http://app:3000/api/domains/tls
  }
}

example.com, app.example.com, *.example.com {
  tls {
    dns <provider> {env.DNS_API_TOKEN} # wildcard needs the DNS challenge
  }
  reverse_proxy app:3000
}

https:// {
  tls {
    on_demand
  }
  reverse_proxy app:3000
}
```

DNS on the platform side: `A example.com`, `A *.example.com` and
`A domains.example.com` → the server's IP (= `CUSTOM_DOMAIN_IP`).

### Vercel

Vercel issues certificates only for domains added to the project. Wildcard
subdomains need the root domain on Vercel nameservers. Specialists' domains
would have to be added and removed through the Vercel Domains API
(`POST /v10/projects/{id}/domains`) in `domain.connect` / `disconnect` — not
implemented yet.

## Not done yet

- Signing in on the specialist's domain itself (cross-domain session handoff).
- Periodic re-verification of active domains (a Hatchet cron task).
- `www.` ↔ apex redirect for connected domains.
