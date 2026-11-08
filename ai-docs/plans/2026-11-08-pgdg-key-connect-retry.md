# Scoped CI PGDG key-connect retry — 2026-11-08

## Problem / evidence
Post-merge server CI [#42506737614](https://github.com/777genius/review-router-ai/actions/runs/42506737614) and [#42515024580](https://github.com/777genius/review-router-ai/actions/runs/42515024580) each failed one mandatory job while downloading the official PGDG signing key from `https://www.postgresql.org/media/keys/ACCC4CF8.asc`: Node/Undici `UND_ERR_CONNECT_TIMEOUT` at 10 seconds. Other jobs passed; do not classify a failed or queued job as green.

## Scope
Modify only the existing `.github/actions/setup-postgresql-client/action.yml` composite action. Retry *transient download failures* at most three times with short bounded delays under its existing five-minute timeout. Preserve the exact official HTTPS key URL, `--use-env-proxy`, APT signed-by configuration, PGDG source, `apt-get` verification, and PostgreSQL 17 version checks. Do not accept alternate keys, skip verification, change runtime code, or create additional workflow machinery.

## Validation and merge
Inspect diff for bounded retry/terminal failure, run exact-head CI with required Quality Gates and PG17/E2E jobs, resolve review findings, squash merge to `main` only on green checks, then verify post-merge server CI and downstream workflows. No production deploy, published tag or runtime-pin change.
