# Review V2 publication item isolation: deployment

## Current disposition - 2026-11-03

Production code: **installed** in verified release227 (`dbc161c986`, image `89a28e11`).
Specific feature scenarios without production evidence remain verification-only,
not a further code rollout.
See the [current decision](2026-11-03-production-status-reconciliation.md) and
[release227 evidence](evidence/2026-11-03-capacity128-release227.json). Older
pending/not-executed entries are historical; owner-waived legacy recovery is not
a redeployment prerequisite. Staging remains unverified.

- Task ID: `2026-10-31-review-publication-item-isolation`.
- Goal: prevent one unexpected publication item error from starving later work or losing the pass's verified settlement evidence, and surface outbox claim-renewal storage failures without dispatching under uncertain ownership.
- Affected targets: ordinary worker (Review V2 maintenance) and Skills scanner worker (shared outbox execution); no task-specific Web/API change.
- Implementation: [PR #751](https://github.com/777genius/review-router-ai/pull/751), based on merged [PR #747](https://github.com/777genius/review-router-ai/pull/747).
- Plan: [implementation contract](../plans/2026-10-31-review-publication-item-isolation.md).
- Required checks: [CI workflow](https://github.com/777genius/review-router-ai/actions/workflows/ci.yml) and [PR #751 exact-head checks](https://github.com/777genius/review-router-ai/pull/751/checks); older green runs are not sufficient for rollout qualification.
- Dependencies: selected release includes PR #747. No task-specific migration, flag, secret, backfill or activation.
- Last updated: `2026-11-03`.

## Environment status

| Environment | Status      | Actual deployed version                     | Verification                                     |
| ----------- | ----------- | ------------------------------------------- | ------------------------------------------------ |
| staging     | `pending`   | Not verified                                | Not executed                                     |
| production  | `installed` | `dbc161c986` / `v1.0.227`, image `89a28e11` | See current disposition; no repeat code rollout. |

`pending` does not establish absence of a deployment. Inspect actual versions
and the [status contract](README.md#status-contract) before proceeding.

## Ordered rollout and checks

1. Reconcile the installed-to-selected range, including PR #747 prerequisites, under the existing [release runbook](../operations/07-environments-and-release-management.md).
2. Qualify the exact selected source: focused item failure/settlement tests, worker integration, architecture, production build, and mandatory CI. PR checks are not environment evidence.
3. Deploy the affected ordinary and Skills scanner workers by the existing authorized coherent process and drain old replicas normally. Do not force-retry claims or replay SCM effects.
4. Verify in disposable/staging fixtures that a failed middle item does not skip later items, only verified terminal results feed progress, defer errors are visible, and isolated item failures report degraded health with unknown `advanced`. A global scan failure must still block progress, and degraded one-shot status must remain truthful.
5. Reconcile normal claim recovery, progress delivery and sanitized reporting. Record shipped commit/image, UTC timestamp, operator and durable verification before marking an environment `deployed`.

Check that an initial outbox `renewClaim` storage exception propagates to the
batch instead of being misreported as `stale_claim`; no handler dispatch may
occur under uncertain ownership. This verification belongs to PR #751, not to
a release containing only PR #747.

Do not inject failures into production. This does not establish exactly-once SCM effects
or prove real provider mutation behavior.

## Retry and rollback

Use [normal rollback](../operations/07-environments-and-release-management.md#rollback).
Reconcile leases and external effects through durable receipts and existing recovery;
never fabricate settlement or replay an uncertain effect. Rollback restores the
single-item-starvation risk. No schema or activation reversal is needed.

## Execution log

No rollout or environment verification receipt is recorded.

## Production R1 /226 — 2026-11-03

The [shared R1 release and environment evidence](evidence/2026-11-03-memory-production-r1-226.json) records official application source `6e6a0f078`, image
`0114caaa…`, all four running roles with zero restarts, and verified 226 producer/channel adoption.

Compatible workers converged after old-role drain. Companion reviews A/B have full coverage and genuine App publication/accounting evidence. B adds zero new issues and retains one lineage from A without resolving the prior issue. Payments remains PARTIAL 0/17 after 32 complete requests; its fresh successor acceptance is pending. Partial settlement/claim-renewal fault cases retain source-test scope; no duplicate publication or production fault injection was performed.

Staging remains unchanged and unverified by this production batch.
