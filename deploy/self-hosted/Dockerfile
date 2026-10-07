# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
WORKDIR /app

ENV CI=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl postgresql-client \
  && rm -rf /var/lib/apt/lists/* \
  && corepack disable pnpm \
  && npm install --global --ignore-scripts --no-audit --no-fund pnpm@10.33.0

FROM base AS build-prisma
ARG REVIEW_ROUTER_WEB_URL
ARG REVIEW_ROUTER_API_URL
ARG REVIEW_ROUTER_PUBLIC_WEB_URL
ARG REVIEW_ROUTER_PUBLIC_API_URL
ENV REVIEW_ROUTER_WEB_URL=${REVIEW_ROUTER_WEB_URL} \
    REVIEW_ROUTER_API_URL=${REVIEW_ROUTER_API_URL} \
    REVIEW_ROUTER_PUBLIC_WEB_URL=${REVIEW_ROUTER_PUBLIC_WEB_URL} \
    REVIEW_ROUTER_PUBLIC_API_URL=${REVIEW_ROUTER_PUBLIC_API_URL}
RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN node scripts/install-private-dependencies.mjs --frozen-lockfile \
  && prisma_client="$(readlink -f packages/platform/db/node_modules/@prisma/client)" \
  && prisma_output="$(dirname "$(dirname "$prisma_client")")/.prisma/client" \
  && mkdir -p "$prisma_output" \
  && chown -R node:node "$prisma_output"
# Grant writes only to the generated client, not the installed packages.
USER node
RUN --network=none \
  env HOME=/home/node REVIEW_ROUTER_PRISMA_NETWORK_ALREADY_ISOLATED=1 \
  node scripts/generate-prisma-offline.mjs

FROM build-prisma AS build
USER root
RUN pnpm --filter @reviewrouter/api... --filter @reviewrouter/worker... --filter @reviewrouter/web... build \
  && node scripts/rewrite-dist-esm-imports.mjs \
  && pnpm store prune

FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0

COPY --from=build --chown=node:node /app /app

USER node

EXPOSE 3000 4000

CMD ["pnpm", "api:start"]
