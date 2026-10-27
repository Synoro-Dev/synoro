# syntax=docker/dockerfile:1
#
# The landing (apps/web) on synoro.ru, deployed by infra/synoro/landing.yaml
# (k3s) as ghcr.io/synoro-dev/synoro-landing. Build from the repo root:
#
#   docker build -f apps/web/Dockerfile -t ghcr.io/synoro-dev/synoro-landing:<tag> \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://synoro.ru .
#
# Next.js `standalone` server (`node apps/web/server.js`, PORT 8080), UID 1001
# (infra/synoro pins it with `runAsUser`).
#
# Stages follow the Turborepo Docker guide: `prune` cuts the monorepo down to
# this app and its workspace dependencies, `build` installs from the pruned
# manifests (that layer is reused until a package.json or the lockfile
# changes) and only then copies the sources.
#
# BUN_VERSION is the latest 1.x release (matches `packageManager`); NODE_VERSION
# is the latest 24.x LTS, the newest line allowed by `engines` in the root
# package.json (>=24.11.1 <25); TURBO_VERSION matches the root devDependency.
# The Dockerfiles of apps/app and packages/jobs share these three.

ARG BUN_VERSION=1.4.4
ARG NODE_VERSION=24.22.1
ARG TURBO_VERSION=2.11.10

# `COPY --from` does not expand variables, so the bun image gets its own stage.
FROM oven/bun:${BUN_VERSION} AS bun

# Node + bun: `next build` must run under Node, the repo's scripts under bun.
FROM node:${NODE_VERSION}-slim AS base
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

FROM base AS prune
ARG TURBO_VERSION
COPY . .
RUN bun x turbo@${TURBO_VERSION} prune @synoro/web --docker

FROM base AS build
# Dependencies first: manifests and lockfile only (bun's isolated linker puts
# symlinks in node_modules, which COPY preserves).
COPY --from=prune /app/out/json/ .
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
COPY --from=prune /app/out/full/ .
COPY .env.example .env.example

# NEXT_PUBLIC_* are inlined into the client bundle here. The optional ones must
# be unset, not empty, when not given: an empty string is not "absent".
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3003
ARG NEXT_PUBLIC_DEMO_URL
ARG NEXT_PUBLIC_YANDEX_METRIKA_ID
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=true
# The build scripts read ../../.env (`bun --env-file`), as in CI. It stays in
# this stage; runtime config comes from the cluster, not from the image.
RUN cp .env.example .env \
    && { [ -n "$NEXT_PUBLIC_DEMO_URL" ] || unset NEXT_PUBLIC_DEMO_URL; } \
    && { [ -n "$NEXT_PUBLIC_YANDEX_METRIKA_ID" ] || unset NEXT_PUBLIC_YANDEX_METRIKA_ID; } \
    && bun turbo build -F @synoro/web

FROM node:${NODE_VERSION}-slim AS web
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd --gid 1001 synoro \
    && useradd --uid 1001 --gid 1001 --no-create-home --shell /usr/sbin/nologin synoro
# The standalone tree keeps the monorepo layout: the server is apps/web/server.js.
COPY --from=build --chown=1001:1001 /app/apps/web/.next/standalone ./
COPY --from=build --chown=1001:1001 /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=1001:1001 /app/apps/web/public ./apps/web/public
USER 1001:1001
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
