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
  claim a domain they don't control. The routing check (CNAME or ALIAS to the
  target) only tells the owner whether traffic already reaches us. A pending reservation lasts 24 hours
  from connection (or hostname replacement); after expiry, connecting the
  hostname again issues a fresh token and allows another practice to claim it.
  Active domains do not expire.

## Environment

```bash
CUSTOM_DOMAIN_CNAME=domains.synoro.ru   # what specialists' DNS points at
```

It lives in `synoro-config` (`infra/synoro/config.yaml`). Unset, the domain page
still verifies ownership but warns that there is nothing to point DNS at.

**A name, never an IP.** Specialists' records are a `TXT` (ownership) and a
`CNAME` to this name; for an apex domain, which can't hold a CNAME, an `ALIAS`
(`ANAME`, «CNAME flattening») to the same name. Nobody is ever told an address,
so the hosting can move (another server, another cloud) by changing one record
of ours, `domains.synoro.ru`. The routing check compares the host with the
target's _current_ addresses, so it follows the move as well. For an ALIAS,
**every** address the host answers with, IPv4 and IPv6, must be the target's:
one foreign A or AAAA would send some visitors (and Let's Encrypt, which
prefers IPv6) elsewhere (`leadsToTarget`, shared by `verify` and the routes
sync). Apex domains need a
registrar that offers ALIAS; where there is none, the owner connects a
subdomain (`zapis.anna.ru`), which the page says.

## Hosting (k3s + Traefik)

Traefik has no «issue on the first request» mode: it asks Let's Encrypt for the
hosts named in its routes. So every verified domain gets a route of its own,
and the cluster follows the database:

```
specialist's DNS ──► node :80/:443 ──► Traefik ──► synoro-app (proxy.ts: Host → /site/<host>)
                                         ▲
   CronJob synoro-domains-sync (every 5 minutes)
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
- A route exists once the TXT record is seen **and** DNS leads here.
- The owner watches it as steps on the domain page (`domain-progress.tsx`):
  TXT → DNS → SSL → «Сайт полностью готов». While the domain isn't secured the
  page re-runs `domain.verify` every 8 s (30 s after ~5 minutes); `verify`
  returns `stage` (`ownership` / `routing` / `certificate` / `ready`). Once DNS
  leads here it also requests `https://<host>/api/domains/check`
  (`servesHttps` in `custom-domains.ts`) — sent to our own entry point
  (`CUSTOM_DOMAIN_CNAME`) with the host as SNI and `Host`, so another server
  the host may point at can't answer for us. That route answers
  `{ practiceId }` only once the practice is resolved by `Host` (the booking
  page itself streams a 200 before its data loads), so a trusted certificate
  **and** the right practice set `practice_domains.secured_at`; a later failed
  check clears it, and the page resumes its steps.
- Every run the CronJob re-checks every active domain (`planReadiness`: a
  route, DNS leading here — on its own, since a route stays through a DNS
  change — and the probe) and sets or clears `secured_at`: a domain becomes
  ready even if the owner closed the page, and stops being offered once it
  breaks. `secured_at` means «works now, since». At most 8 domains are probed
  at once.
- Checks overlap (the page, a second tab, the sync), so every readiness write
  is guarded: it touches only the very record it checked (`id` and
  `verification_token`; a new reservation gets a new token), and only if no
  check that started later has written since — `last_checked_at` holds when
  the last written check started.
- With `secured_at` set the domain is the practice's address in the console:
  `practice.get` / `practice.mine` return `siteDomain`, shown first in
  «Страница записи» (`BookingLinkActions`), in the sidebar and the practice
  switcher. A new hostname clears it.
- Disconnecting removes the route within 5 minutes (the next sync). The certificate stays in
  Traefik's `acme.json` and expires on its own.

Platform DNS (where `synoro.ru` is managed): `A domains.synoro.ru` → the node's
public IP. That record is the only place the address lives; moving the hosting
means editing it (keep the TTL low, say 300 s) and nothing on the specialists'
side. If the cluster is ever fronted by a balancer with a name of its own,
`domains.synoro.ru` becomes a CNAME to it. Records must lead straight to us: a
domain behind a CDN or proxy can't pass the HTTP-01 challenge, so the owner is
told to turn proxying off.

Moving the hosting: bring the new Traefik up with the same `acme.json` (or let
it request the certificates again, which is a few minutes of warnings), then
switch `domains.synoro.ru`. Routes are created from the database, so the CronJob
rebuilds them on the new cluster by itself.

Prerequisites to check on the cluster (the shared Traefik Helm release): the
`letsencrypt` resolver stores `acme.json` on a persistent volume, and Traefik
runs a single replica (HTTP-01 needs the same instance to answer the challenge
it started).

### Alternative: Caddy with on-demand TLS

`GET /api/domains/tls?domain=` answers 200 only for active domains. It is the
`ask` endpoint of Caddy's on-demand TLS, which issues a certificate at the first
visit instead of on the next sync run. Not used on k3s (it would need Caddy behind a
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
