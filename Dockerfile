# syntax=docker/dockerfile:1
#
# Images deployed by infra/synoro (k3s). Build both from the repo root:
#
#   docker build --target app   -t ghcr.io/synoro-dev/synoro-app:<tag> \
#     --build-arg NEXT_PUBLIC_APP_URL=https://app.synoro.ru .
#   docker build --target tools -t ghcr.io/synoro-dev/synoro-tools:<tag> .
#
# app   Next.js `standalone` server (`node apps/app/server.js`, PORT 3000).
# tools Built workspace + bun: migrations (`packages/db/src/scripts/migrate.ts`)
#       and the Hatchet worker (`packages/jobs/src/worker.ts`). Overrides the
#       command in the manifests.
#
# Both run as UID 1001, which infra/synoro pins with `runAsUser`.
# BUN_VERSION is the latest 1.x release (matches `packageManager`); NODE_VERSION
# is the latest 24.x LTS, the newest line allowed by `engines` in the root
# package.json (>=24.11.1 <25).

ARG BUN_VERSION=1.4.4
ARG NODE_VERSION=24.22.1

# `COPY --from` does not expand variables, so the bun image gets its own stage.
FROM oven/bun:${BUN_VERSION} AS bun

# Node + bun: `next build` must run under Node, the repo's scripts under bun.
FROM node:${NODE_VERSION}-slim AS base
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

# Sources + installed dependencies (bun's isolated linker: symlinks in
# node_modules, which COPY preserves).
FROM base AS source
COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# ---------------------------------------------------------------------------
# tools
# ---------------------------------------------------------------------------
FROM source AS tools-build
# `config`, `emails` and `storage` compile to dist/ and are consumed from there.
RUN bun turbo build -F @synoro/jobs...

FROM oven/bun:${BUN_VERSION}-slim AS tools
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --gid 1001 synoro \
    && useradd --uid 1001 --gid 1001 --no-create-home --shell /usr/sbin/nologin synoro
COPY --from=tools-build --chown=1001:1001 /app ./
USER 1001:1001
CMD ["bun", "run", "packages/db/src/scripts/migrate.ts"]

# ---------------------------------------------------------------------------
# app
# ---------------------------------------------------------------------------
FROM source AS app-build
# NEXT_PUBLIC_* are inlined into the client bundle here, so they must be the
# production values. Defaults mirror apps/app and packages/config.
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_APP_NAME="Acme Inc."
ARG NEXT_PUBLIC_APP_SHORT_NAME=Acme
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_PUBLIC_APP_SHORT_NAME=$NEXT_PUBLIC_APP_SHORT_NAME \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=true
# The build scripts read ../../.env (`bun --env-file`), as in CI. It stays in
# this stage; runtime config comes from the cluster, not from the image.
RUN cp .env.example .env && bun turbo build -F @synoro/app

FROM node:${NODE_VERSION}-slim AS app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd --gid 1001 synoro \
    && useradd --uid 1001 --gid 1001 --no-create-home --shell /usr/sbin/nologin synoro
# The standalone tree keeps the monorepo layout: the server is apps/app/server.js.
COPY --from=app-build --chown=1001:1001 /app/apps/app/.next/standalone ./
COPY --from=app-build --chown=1001:1001 /app/apps/app/.next/static ./apps/app/.next/static
COPY --from=app-build --chown=1001:1001 /app/apps/app/public ./apps/app/public
USER 1001:1001
EXPOSE 3000
CMD ["node", "apps/app/server.js"]
