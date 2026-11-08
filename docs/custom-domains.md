# Practice pages on their own domains

A specialist on «Про» connects their own domain under **Практика → Свой домен**
and the booking page opens there. The platform side is Traefik on k3s: a route
and a Let's Encrypt certificate per domain, kept in step with the database by a
CronJob (see «Hosting»). Without that side nothing opens, so it goes live in
this order: the DNS record, `config.yaml` and `http.yaml` of the infra repo,
the app deploy, and only then `domains.yaml` (its script ships in the
`synoro-tools` image, which the deploy pushes).

A practice's booking page opens at two kinds of address:

| Address                                            | Setup                                             |
| -------------------------------------------------- | ------------------------------------------------- |
| `https://synoro.ru/anna`                           | always                                            |
| `https://anna-psy.ru`, `https://zapis.anna-psy.ru` | owner connects it under **Практика → Свой домен** |

There are no platform subdomains (`anna.synoro.ru`). The page can also be
embedded in the specialist's site (`docs/guest-booking.md`).

## How it works

- `apps/app/src/proxy.ts` looks at `Host`. Anything that isn't the app's own
  host (`APP_URL`, `BOOKING_URL`, `NEXT_PUBLIC_APP_URL`, exact
  `AUTH_TRUSTED_ORIGINS`) is a practice host: `/` is rewritten to
  `/site/<host>`, `/_next/*` and files are served as is, every other path
  redirects to the same path on `APP_URL`.
- `/site/[host]` resolves the practice with `practice.byHost`: an **active**
  row in `practice_domains`.
- Sign-in and the cabinet stay on the app host: the session cookie is never
  set for a specialist's domain. On a practice host the page is read-only for
  visitors; «Войти и записаться» leads to `/<slug>` on the app host.
- `BOOKING_URL` and exact `AUTH_TRUSTED_ORIGINS` (e.g. `https://example.com`)
  count as app hosts and can't be claimed, nor can anything under them.
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
CUSTOM_DOMAIN_CNAME=domains.synoro.ru   # what subdomains CNAME to
CUSTOM_DOMAIN_IP=203.0.113.10           # what apex domains point an A record to
```

Both live in `synoro-config` (`infra/synoro/config.yaml`). Unset, the domain
page still verifies ownership but warns that there is nothing to point DNS at.

## Hosting (k3s + Traefik)

Traefik has no «issue on the first request» mode: it asks Let's Encrypt for the
hosts named in its routes. So every verified domain gets a route of its own,
and the cluster follows the database:

```
specialist's DNS ──► node :80/:443 ──► Traefik ──► synoro-app (proxy.ts: Host → /site/<host>)
                                         ▲
   CronJob synoro-domains-sync (every minute)
     1. active domains from `practice_domains`
     2. keeps those whose DNS already leads here (a certificate request for
        a host that doesn't would fail, and Traefik doesn't retry)
     3. server-side apply of IngressRoute `cd-<host>` (HTTP-01, resolver
        `letsencrypt`); deletes `cd-*` routes of disconnected domains
```

- Code: `packages/jobs/src/custom-domains.ts` (what the routes are, pure, with
  tests) and `packages/jobs/src/scripts/sync-domains.ts` (database + Kubernetes
  API). `bun domains:sync -- --dry-run` prints the plan locally.
- Manifests (`infra/synoro/domains.yaml`): ServiceAccount, a Role that allows
  only `ingressroutes`, the CronJob on the `synoro-tools` image. Plain http for
  unknown hosts redirects to https from `infra/synoro/http.yaml`.
- The script touches only routes labelled `app.kubernetes.io/managed-by:
synoro-domains-sync`. It refuses anything that isn't a plain hostname, and the
  platform's own hosts (`APP_URL`, `BOOKING_URL`, `ADMIN_URL`, exact
  `AUTH_TRUSTED_ORIGINS`), whatever the database says: a route is a rule with
  the host in it.
- A route exists once the TXT record is seen **and** DNS leads here. The owner
  sees it as: «Проверить DNS» → both marks green → https works in 2–5 minutes.
- Disconnecting removes the route within a minute. The certificate stays in
  Traefik's `acme.json` and expires on its own.

Platform DNS (where `synoro.ru` is managed): `A domains.synoro.ru` → the node's
public IP, which is also `CUSTOM_DOMAIN_IP`. Specialists' subdomains CNAME to
`domains.synoro.ru`, so moving the node later means changing one record of
ours; apex domains hold the IP itself. Records must point straight at the node:
a domain behind a CDN or proxy can't pass the HTTP-01 challenge, so the owner is
told to turn proxying off.

Prerequisites to check on the cluster (the shared Traefik Helm release): the
`letsencrypt` resolver stores `acme.json` on a persistent volume, and Traefik
runs a single replica (HTTP-01 needs the same instance to answer the challenge
it started).

### Alternative: Caddy with on-demand TLS

`GET /api/domains/tls?domain=` answers 200 only for active domains. It is the
`ask` endpoint of Caddy's on-demand TLS, which issues a certificate at the first
visit instead of within a minute. Not used on k3s (it would need Caddy behind a
TCP passthrough in Traefik); kept for a self-hosted setup:

```caddyfile
{
  on_demand_tls {
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

## Not done yet

- Signing in on the specialist's domain itself (cross-domain session handoff).
- Periodic re-verification of active domains (a Hatchet cron task): a domain
  that has since moved away keeps its route until the owner disconnects it.
- `www.` ↔ apex redirect for connected domains.
