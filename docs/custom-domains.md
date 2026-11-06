# Practice pages on their own domains

**Off sale.** Production has no `CUSTOM_DOMAIN_*`, no on-demand TLS and no route
for foreign hosts, so a connected domain wouldn't open. The landing and plans
don't offer it and `practiceSections` has no link to `/practices/<id>/domain`;
the code stays for when the hosting side is set up. A specialist shares
`synoro.ru/<slug>` or embeds it in their site (`docs/guest-booking.md`). There
are no platform subdomains (`anna.synoro.ru`).

A practice's booking page opens at two kinds of address:

| Address                                            | Setup                                        |
| -------------------------------------------------- | -------------------------------------------- |
| `https://example.com/anna`                         | always                                       |
| `https://anna-psy.ru`, `https://zapis.anna-psy.ru` | owner connects it under **Практика → Домен** |

## How it works

- `apps/app/src/proxy.ts` looks at `Host`. Anything that isn't the app's own
  host (`APP_URL`, `NEXT_PUBLIC_APP_URL`, exact `AUTH_TRUSTED_ORIGINS`) is a
  practice host: `/` is rewritten to `/site/<host>`, `/_next/*` and files are
  served as is, every other path redirects to the same path on `APP_URL`.
- `/site/[host]` resolves the practice with `practice.byHost`: an **active**
  row in `practice_domains`.
- Sign-in and the cabinet stay on the app host: the session cookie is never
  set for a specialist's domain. On a practice host the page is read-only for
  visitors; «Войти и записаться» leads to `/<slug>` on the app host.
- Exact `AUTH_TRUSTED_ORIGINS` (e.g. `https://example.com`) count as app hosts
  and can't be claimed, nor can anything under them.
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
CUSTOM_DOMAIN_CNAME=domains.example.com # what subdomains CNAME to
CUSTOM_DOMAIN_IP=203.0.113.10           # what apex domains point an A record to
```

## Hosting

Specialists' domains need TLS certificates issued on demand.

### Self-hosted (Docker, `output: "standalone"`) behind Caddy

```caddyfile
{
  on_demand_tls {
    # 200 only for verified domains.
    ask http://app:3000/api/domains/tls
  }
}

example.com, app.example.com {
  reverse_proxy app:3000
}

https:// {
  tls {
    on_demand
  }
  reverse_proxy app:3000
}
```

DNS on the platform side: `A example.com` and `A domains.example.com` → the
server's IP (= `CUSTOM_DOMAIN_IP`).

Records must point straight at our server: a domain proxied through a CDN
can't pass the TLS challenge and its traffic never reaches Caddy, so the
owner is told to turn proxying off (Практика → Домен).

## Not done yet

- Signing in on the specialist's domain itself (cross-domain session handoff).
- Periodic re-verification of active domains (a Hatchet cron task).
- `www.` ↔ apex redirect for connected domains.
