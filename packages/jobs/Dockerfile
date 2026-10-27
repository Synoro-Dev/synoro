# syntax=docker/dockerfile:1
#
# Migrations and the Hatchet worker, deployed by infra/synoro (k3s) as
# ghcr.io/synoro-dev/synoro-tools. Build from the repo root:
#
#   docker build -f packages/jobs/Dockerfile -t ghcr.io/synoro-dev/synoro-tools:<tag> .
#
# The built workspace plus bun. The default command runs the migrations
# (`packages/db/src/scripts/migrate.ts`); the worker (`packages/jobs/src/worker.ts`)
# overrides the command in the manifests. UID 1001, as in the app images.
#
# `@synoro/db` is pruned alongside `@synoro/jobs`: the migrate script lives
# there and jobs does not depend on it.
#
# Versions: see apps/web/Dockerfile; keep the three Dockerfiles in sync.

ARG BUN_VERSION=1.4.4
ARG NODE_VERSION=24.22.1
ARG TURBO_VERSION=2.11.10

# `COPY --from` does not expand variables, so the bun image gets its own stage.
FROM oven/bun:${BUN_VERSION} AS bun

FROM node:${NODE_VERSION}-slim AS base
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

FROM base AS prune
ARG TURBO_VERSION
COPY . .
RUN bunx turbo@${TURBO_VERSION} prune @synoro/jobs @synoro/db --docker

FROM base AS build
# Dependencies first: manifests and lockfile only (bun's isolated linker puts
# symlinks in node_modules, which COPY preserves).
COPY --from=prune /app/out/json/ .
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
COPY --from=prune /app/out/full/ .
# `config`, `emails` and `storage` compile to dist/ and are consumed from there.
RUN bun turbo build -F @synoro/jobs...

FROM oven/bun:${BUN_VERSION}-slim AS tools
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --gid 1001 synoro \
    && useradd --uid 1001 --gid 1001 --no-create-home --shell /usr/sbin/nologin synoro
COPY --from=build --chown=1001:1001 /app ./
USER 1001:1001
CMD ["bun", "run", "packages/db/src/scripts/migrate.ts"]
