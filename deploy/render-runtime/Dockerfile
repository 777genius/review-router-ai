# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim@sha256:65932751ed4073ed02f5c04e494e4b2572a891b7dbea0568a863dc80341bf848 AS build

WORKDIR /app

ENV CI=1 \
    NEXT_TELEMETRY_DISABLED=1 \
    REVIEW_ROUTER_WEB_URL=https://reviewrouter.site \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@10.33.0 --activate

# Fetch the pinned public dependency over HTTPS in the build stage.
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm db:generate \
  && pnpm build \
  && node --conditions=production -e "await import('@reviewrouter/platform-db'); await import('@reviewrouter/features-release-rollout')" \
  && pnpm store prune

FROM node:24-bookworm-slim@sha256:65932751ed4073ed02f5c04e494e4b2572a891b7dbea0568a863dc80341bf848 AS runtime

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
    COREPACK_HOME=/pnpm/corepack \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN mkdir -p "$COREPACK_HOME" \
  && corepack enable \
  && corepack prepare pnpm@10.33.0 --activate \
  && chmod -R a+rX "$COREPACK_HOME"

COPY --from=build --chown=node:node /app /app
COPY --chown=root:root deploy/render-runtime/entrypoint.sh /usr/local/bin/reviewrouter-runtime
RUN chmod 0555 /usr/local/bin/reviewrouter-runtime

USER node

ENV COREPACK_ENABLE_NETWORK=0
RUN --network=none pnpm --version | grep -Fxq '10.33.0'

EXPOSE 10000

ENTRYPOINT ["/usr/local/bin/reviewrouter-runtime"]
