# syntax=docker/dockerfile:1
#
# The app (apps/app) on app.synoro.ru and demo.synoro.ru, deployed by
# infra/synoro/app.yaml (k3s) as ghcr.io/synoro-dev/synoro-app. Build from the
# repo root:
#
#   docker build -f apps/app/Dockerfile -t ghcr.io/synoro-dev/synoro-app:<tag> \
#     --build-arg NEXT_PUBLIC_APP_URL=https://app.synoro.ru .
#
# Next.js `standalone` server (`node apps/app/server.js`, PORT 3000), UID 1001
# (infra/synoro pins it with `runAsUser`).
#
# Stages follow the Turborepo Docker guide: `prune` cuts the monorepo down to
# this app and its workspace dependencies, `build` installs from the pruned
# manifests (that layer is reused until a package.json or the lockfile
# changes) and only then copies the sources.
#
# Versions: see apps/web/Dockerfile; keep the three Dockerfiles in sync.

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
RUN bun x turbo@${TURBO_VERSION} prune @synoro/app --docker

FROM base AS build
# Dependencies first: manifests and lockfile only (bun's isolated linker puts
# symlinks in node_modules, which COPY preserves).
COPY --from=prune /app/out/json/ .
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
COPY --from=prune /app/out/full/ .
COPY .env.example .env.example

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
# `next build` runs in production mode, where Better Auth refuses an empty
# secret while prerendering. Throwaway value: the real AUTH_SECRET comes from
# the cluster at runtime.
RUN cp .env.example .env \
    && sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=build-only-not-a-secret|" .env \
    && bun turbo build -F @synoro/app

FROM node:${NODE_VERSION}-slim AS app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd --gid 1001 synoro \
    && useradd --uid 1001 --gid 1001 --no-create-home --shell /usr/sbin/nologin synoro
# The standalone tree keeps the monorepo layout: the server is apps/app/server.js.
COPY --from=build --chown=1001:1001 /app/apps/app/.next/standalone ./
COPY --from=build --chown=1001:1001 /app/apps/app/.next/static ./apps/app/.next/static
COPY --from=build --chown=1001:1001 /app/apps/app/public ./apps/app/public
USER 1001:1001
EXPOSE 3000
CMD ["node", "apps/app/server.js"]
