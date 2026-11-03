# GitHub webhook error privacy: deployment

- Task ID: `2026-10-31-github-webhook-error-privacy`.
- Goal: GitHub webhook error privacy.
- Affected services: API.
- Implementation: [PR #755](https://github.com/777genius/review-router-ai/pull/755); [plan](../plans/2026-10-31-github-webhook-error-privacy.md).
- Implementation reference: `4541cab68c6be5fbd31f7eb46dc2a9aa4a002d7f` (security-reviewed implementation baseline, not proof of merge or deployment; qualify current PR head separately).
- No schema migration, feature flag, manual activation or production secret changes are introduced.
- Last updated: `2026-11-03`.

## Environment status

| Environment | Status        | Installed release / image                           | Actual verification                                |
| ----------- | ------------- | --------------------------------------------------- | -------------------------------------------------- |
| staging     | `pending`     | Not verified                                        | Not executed                                       |
| production  | `in_progress` | `6e6a0f078` / official `v1.0.226`, image `0114caaa` | See current R1 evidence and remaining scope below. |

`pending` means no verified deployment evidence is recorded, not observed absence.
This task does not authorize deployment.

## Ordered rollout

1. Inspect actual target versions and the installed-to-selected release range. Follow the [existing release runbook](../operations/07-environments-and-release-management.md) and reconcile earlier pending tasks.
2. Require exact selected-source type/format/architecture, build, test, relevant E2E, security review and mandatory CI gates. Signed Fastify HTTP test with credential-bearing handler failure; confirm stored summary and response contain no secret; run mandatory CI.
3. Deploy the authorized coherent API build with the existing procedure. Errors now return opaque HTTP 500 and persist only allowlisted failure codes. Confirm operators use delivery ID/status for diagnosis rather than raw exception text, and validate signed delivery retry.
4. Inspect normal health, error counters, retries, installation/session behavior and related downstream effects. Only after real verification, record installed commit/image, UTC timestamp, operator and durable evidence, then mark that environment `deployed`.

## Recovery and rollback

Use the [ordinary rollback process](../operations/07-environments-and-release-management.md#rollback).
Preserve persisted delivery/inventory/session facts. Never fabricate a successful
provider operation or replay an uncertain external effect. Verify compatible
rollback behavior against active sessions and the target fleet.

## Execution log

No rollout attempt or environment verification receipt is recorded.

## Production R1 /226 — 2026-11-03

The [shared R1 release and environment evidence](evidence/2026-11-03-memory-production-r1-226.json) records official application source `6e6a0f078`, image
`0114caaa…`, all four running roles with zero restarts, and verified 226 producer/channel adoption.

The API privacy code is installed through the coherent release. The fresh signed GitHub repository event passed its normal delivery/outbox path. No secret-bearing error was injected in production; isolated signed regression evidence retains its own source scope, and broader error-path production observations remain unclaimed.

Staging remains unchanged and unverified by this production batch.
