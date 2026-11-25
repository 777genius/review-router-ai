# Issuer-bound GitLab CI authorization: deployment

- Task ID: `2026-10-31-gitlab-oidc-issuer-scope`.
- Goal: Issuer-bound GitLab CI authorization.
- Affected services: API.
- Implementation: [PR #754](https://github.com/777genius/review-router-ai/pull/754); [plan](../plans/2026-10-31-gitlab-oidc-issuer-scope.md).
- Implementation reference: `504f0bc63b4e2391594e10eaa2dca1839f10dbac` (security-reviewed implementation baseline; current PR head must pass its own CI; no deployment implied).
- No schema migration, feature flag, manual activation or production secret changes are introduced.
- Last updated: `2026-11-03`.

## Environment status

| Environment | Status    | Installed release / image                           | Actual verification                                |
| ----------- | --------- | --------------------------------------------------- | -------------------------------------------------- |
| staging     | `pending` | Not verified                                        | Not executed                                       |
| production  | `pending` | `6e6a0f078` / official `v1.0.226`, image `0114caaa` | See current R1 evidence and remaining scope below. |

`pending` means no verified deployment evidence is recorded, not observed absence.
This task does not authorize deployment.

## Ordered rollout

1. Inspect actual target versions and the installed-to-selected release range. Follow the [existing release runbook](../operations/07-environments-and-release-management.md) and reconcile earlier pending tasks.
2. Require exact selected-source type/format/architecture, build, test, relevant E2E, security review and mandatory CI gates. Check signed issuer/project lookup, DB selected=false precedence, same-ID multi-server fixture, API runtime and mandatory CI.
3. Before rollout, read-only inspect existing `RepositoryConnection` GitLab rows for noncanonical `sourceBaseUrl` values (especially trailing `/`) and for duplicate `(provider, externalRepositoryId, normalized source origin)` keys. Migration `000024` backfills GitLab URLs to `https://gitlab.com`, and the current discovery/installation writer uses normalized origins; do not assume external/manual records follow that invariant. If any outliers or collisions exist, **stop the rollout** until an explicitly authorized operator reconciles ownership and normalizes data; do not silently select a record or change the database as part of this PR.
4. Deploy the authorized coherent API build with the existing procedure. Verify OIDC issuer setting matches GitLab source origin and self-hosted static inventory supplies its optional sourceBaseUrl. Inspect any existing ambiguous GitLab static definitions before rollout.
5. Inspect normal health, error counters, retries, installation/session behavior and related downstream effects. Only after real verification, record installed commit/image, UTC timestamp, operator and durable evidence, then mark that environment `deployed`.

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

The inherited API issuer-scope code is installed. GitLab-specific signed issuer/sourceBaseUrl/duplicate-origin acceptance remains unverified for the out-of-scope GitLab cohort. No sourceBaseUrl rewrite or authority repair is implied.

Staging remains unchanged and unverified by this production batch.
