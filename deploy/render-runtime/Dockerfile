# syntax=docker/dockerfile:1.7

FROM node:26.11.1-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567 AS build

WORKDIR /app

ENV CI=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    REVIEW_ROUTER_WEB_URL=https://reviewrouter.org \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global --ignore-scripts --no-audit --no-fund pnpm@11.28.7

# Fetch the pinned public dependency over HTTPS in the build stage.
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm db:generate \
  && TURBO_CONCURRENCY=2 pnpm build \
  && pnpm store prune

FROM node:26.11.1-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567 AS runtime

ARG IMAGE_REVISION
ARG IMAGE_VERSION

LABEL org.opencontainers.image.source="https://github.com/777genius/review-router-ai" \
      org.opencontainers.image.revision="${IMAGE_REVISION}" \
      org.opencontainers.image.version="${IMAGE_VERSION}"

WORKDIR /app

ENV CI=1 \
    HOST=0.0.0.0 \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global --ignore-scripts --no-audit --no-fund pnpm@11.28.7

COPY --from=build --chown=node:node /app /app
COPY --chown=root:root deploy/render-runtime/entrypoint.sh /usr/local/bin/reviewrouter-runtime
RUN chmod 0555 /usr/local/bin/reviewrouter-runtime

USER node

EXPOSE 10000

ENTRYPOINT ["/usr/local/bin/reviewrouter-runtime"]
