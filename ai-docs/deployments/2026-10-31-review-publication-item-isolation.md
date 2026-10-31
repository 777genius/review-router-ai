# Review V2 publication item isolation: deployment

- Task ID: `2026-10-31-review-publication-item-isolation`.
- Goal: prevent one unexpected publication item error from starving later work or losing the pass's verified settlement evidence.
- Affected targets: ordinary worker (Review V2 maintenance); no task-specific Web/API/Skills change.
- Implementation: [PR #751](https://github.com/777genius/review-router-ai/pull/751), stacked on [PR #747](https://github.com/777genius/review-router-ai/pull/747).
- Plan: [implementation contract](../plans/2026-10-31-review-publication-item-isolation.md).
- Dependencies: selected release includes PR #747. No task-specific migration, flag, secret, backfill or activation.
- Last updated: `2026-10-31`.

## Environment status

| Environment | Status    | Actual deployed version | Verification |
| ----------- | --------- | ----------------------- | ------------ |
| staging     | `pending` | Not verified            | Not executed |
| production  | `pending` | Not verified            | Not executed |

`pending` does not establish absence of a deployment. Inspect actual versions
and the [status contract](README.md#status-contract) before proceeding.

## Ordered rollout and checks

1. Reconcile the installed-to-selected range, including PR #747 prerequisites, under the existing [release runbook](../operations/07-environments-and-release-management.md).
2. Qualify the exact selected source: focused item failure/settlement tests, worker integration, architecture, production build, and mandatory CI. PR checks are not environment evidence.
3. Deploy the affected worker by the existing authorized process and drain old worker replicas normally. Do not force-retry claims or replay SCM effects.
4. Verify in disposable/staging fixtures that a failed middle item does not skip later items, only verified terminal results feed progress, defer errors are visible, global scan failure still blocks progress, and degraded one-shot status remains truthful.
5. Reconcile normal claim recovery, progress delivery and sanitized reporting. Record shipped commit/image, UTC timestamp, operator and durable verification before marking an environment `deployed`.

Do not inject failures into production. This does not establish exactly-once SCM effects
or prove real provider mutation behavior.

## Retry and rollback

Use [normal rollback](../operations/07-environments-and-release-management.md#rollback).
Reconcile leases and external effects through durable receipts and existing recovery;
never fabricate settlement or replay an uncertain effect. Rollback restores the
single-item-starvation risk. No schema or activation reversal is needed.

## Execution log

No rollout or environment verification receipt is recorded.
