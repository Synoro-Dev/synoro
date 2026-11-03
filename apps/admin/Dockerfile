# syntax=docker/dockerfile:1
#
# The admin site (apps/admin) on admin.synoro.ru, deployed by
# infra/synoro/admin.yaml (k3s) as ghcr.io/synoro-dev/synoro-admin. Build from
# the repo root:
#
#   docker build -f apps/admin/Dockerfile -t ghcr.io/synoro-dev/synoro-admin:<tag> .
#
# Next.js `standalone` server (`node apps/admin/server.js`, PORT 3000), UID
# 1001 (infra/synoro pins it with `runAsUser`). No NEXT_PUBLIC_* build args:
# everything it needs (ADMIN_URL, the database, auth) is read at runtime.
#
# Stages follow the Turborepo Docker guide: `prune` cuts the monorepo down to
# this app and its workspace dependencies, `build` installs from the pruned
# manifests (that layer is reused until a package.json or the lockfile
# changes) and only then copies the sources.
#
# Versions: see apps/web/Dockerfile; keep the four Dockerfiles in sync.

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
RUN bun x turbo@${TURBO_VERSION} prune @synoro/admin --docker

FROM base AS build
# Dependencies first: manifests and lockfile only (bun's isolated linker puts
# symlinks in node_modules, which COPY preserves).
COPY --from=prune /app/out/json/ .
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
COPY --from=prune /app/out/full/ .
COPY .env.example .env.example

ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=true
# The build scripts read ../../.env (`bun --env-file`), as in CI. It stays in
# this stage; runtime config comes from the cluster, not from the image.
# `next build` runs in production mode, where Better Auth refuses an empty
# secret. Throwaway value: the real AUTH_SECRET comes from the cluster.
RUN cp .env.example .env \
    && sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=build-only-not-a-secret|" .env \
    && bun turbo build -F @synoro/admin

FROM node:${NODE_VERSION}-slim AS app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
WORKDIR /app
RUN groupadd --gid 1001 synoro \
    && useradd --uid 1001 --gid 1001 --no-create-home --shell /usr/sbin/nologin synoro
# The standalone tree keeps the monorepo layout: the server is apps/admin/server.js.
COPY --from=build --chown=1001:1001 /app/apps/admin/.next/standalone ./
COPY --from=build --chown=1001:1001 /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build --chown=1001:1001 /app/apps/admin/public ./apps/admin/public
USER 1001:1001
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]
