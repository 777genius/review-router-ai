# Public AI-agent discovery — Web deployment

- Task ID: `2026-11-02-public-agent-discovery`.
- Implementation: [PR #786](https://github.com/777genius/review-router-ai/pull/786); [implementation plan](../plans/2026-11-02-agent-discovery-public-web.md).
- Affected services: ReviewRouter **Web / Next.js** build only, including static `public/` assets and homepage metadata. The API host's existing read-only demo routes are *referenced*, not modified.
- Prerequisites: exact shipping source revision, signed/verified release and selected immutable Web image digest through the [release source of truth](../operations/07-environments-and-release-management.md). Reconcile unfinished release tasks before shipping.
- No database migration, new env secret, feature flag, Action pin change, OAuth change, public API endpoint, worker activation or new entitlement required.

| Environment | Status | Actual revision / image | Evidence |
| --- | --- | --- | --- |
| staging | `pending` | Not deployed / unverified | No staging rollout or HTTP smoke |
| production | `pending` | Not deployed / unverified | No production rollout or HTTP smoke |

## Pre-deploy and release

1. Identify the reviewed, merged PR SHA and the exact **shipping main/release** SHA; read the maintained [release process](../operations/07-environments-and-release-management.md), this task and all unfinished applicable deployment tasks. A green PR CI or merge is **not** a deploy.
2. Run the current release gates on that exact release SHA: relevant Web build/typecheck/format, `apps/web/app/agent-discovery.test.ts`, and the production `pnpm web:smoke` against the candidate image. Preserve evidence for the actual revision, not an older PR head.
3. Ensure `reviewrouter-web` is published via the approved immutable digest/release mechanism (not a mutable tag or an unreviewed Render auto-deploy). If the maintained rollout process requires a coordinated Web/API/worker release, use the coherent image/digest and preserve existing contract gates; **do not** deploy or change API/worker independently for this docs change.
4. Record the actual Render deployment and image digest only after provider-reported live status matches the exact desired image. Never use a missing/queued GitHub check as evidence of release readiness.

## Production HTTP acceptance (unauthenticated read-only)

For `https://reviewrouter.org`, check HTTP status, media type and body for each path without following unexpected redirects:

- `/llms.txt`: HTTP 200, textual, includes real `/getting-started`, `/auth.md`, `/agents.md`, and the exact demo OpenAPI link.
- `/auth.md`: HTTP 200, readable text/Markdown, explains GitHub/GitLab user consent and correctly denies a public general-purpose agent OAuth API.
- `/agents.md`: HTTP 200, readable text/Markdown, explains the user-approved setup PR and provider secret boundaries.
- `/`: HTTP 200, one page canonical and truthful `WebApplication` JSON-LD with zero-dollar **current CI control-plane** `Offer` but no paid hosted tier checkout.
- `/getting-started`, `/security`, `/pricing`: remain available with their existing metadata/content. Unknown `/api/` URLs must not become a public agent-action surface as a consequence of the deployment.
- Confirm linked `https://api.reviewrouter.org/demo.md` and `/openapi.json` remain the existing **demo**, not a newly exposed authenticated API; do not attempt write probes or expose tokens.

Use the established [hosted Web smoke](../../scripts/check-hosted-web.mjs), plus direct GET/content-type/JSON-LD reads for these paths. Capture exact UTC timestamp, URL/status/media-type, response snippet/digest, deployed release SHA, image digest, deployment ID and check logs with no credentials or private data. If any expected route fails, mark this task blocked and do not claim production is qualified.

## Rollback / recovery

- Restore the **previous confirmed Web release/image digest** using the maintained [release workflow](../operations/07-environments-and-release-management.md) and [Render runbook](../../deploy/render.md); don't guess a digest or promote mutable tags.
- This change has no schema migration or data conversion to roll back. Preserve existing API, worker, identity and OAuth configuration; do not disable authorization or relax response policy to recover discovery pages.
- Repeat the current public routes and auth-boundary smoke after rollback; record which version is live and why promotion failed.
- After any deploy attempt, update the staging/production rows and the [task index](README.md) with actual observed evidence and remaining steps. **Merge alone leaves both environments `pending`.**

No deployment was executed as part of implementation PR #786.
