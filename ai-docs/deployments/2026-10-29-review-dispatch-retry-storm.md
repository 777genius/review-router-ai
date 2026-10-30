# Review dispatch retry storm: deployment

- Task ID: `2026-10-29-review-dispatch-retry-storm`.
- Goal: a dispatched review run that ends before authorization is redispatched only when a fresh run can help. Runs cancelled by an operator, skipped or waiting for approval stop their request without a successor, and the delay between redispatch attempts grows instead of staying at a fixed 30 seconds.
- Targets: every review-v2 worker that runs ReviewRequested dispatch recovery. No API, Web, schema, Action or workflow change.
- Implementation: [PR #742](https://github.com/777genius/review-router-ai/pull/742).
- Implementation reference: the head of PR #742 (first commit `e58368618847c1bdb674e5a0c84402cd3c9bb16c` plus review follow-ups). The final merged commit and the shipping version must be recorded separately.
- Dependencies: none of its own. It ships with whatever main integration the selected release contains, so read the other unfinished registry entries for that release.
- Last updated: 2026-10-29.

## Environment status

| Environment | Status        | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker                                                                                                                                                                  |
| ----------- | ------------- | ------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| staging     | `pending`     | Not verified                    | Not verified        | Select the authorized cohort and deploy the worker with it.                                                                                                                                     |
| production  | `in_progress` | `533c040d` / image `e1578f75`   | 2026-10-30 17:35    | Code and migrations deployed, see [Production rollout 2026-10-30](2026-10-30-production-rollout-533c040d.md). Task-specific live verification is not recorded yet: verify below and then close. |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## Applicability and prerequisites

- The selected release must contain the merged PR. A green PR or a merge into `main` is not deployment evidence; there is no automatic deployment from `main`.
- No migration, flag or data conversion. The new dispatch run status is an in-memory classification and is not persisted. Existing requests keep their states: an already `Superseded` request is not revisited, and a successor the previous worker already created is still dispatched once by the new worker. Requests still awaiting authorization are classified by the new rules on their next recovery pass.
- Interim mitigation before the worker is deployed: `REVIEW_ROUTER_REVIEW_V2_INTENT_MAX_DISPATCH_ATTEMPTS=1` stops automatic redispatch entirely. Remove it after the new worker is verified if retries are wanted again.

## Ordered rollout

Ordinary code deployment is sufficient. Deploy the selected worker build through the
[release process](../operations/07-environments-and-release-management.md) together
with the rest of the selected release. There is no activation step.

## Verification and completion

- After rollout, cancelling a queued or running ReviewRouter run for an unchanged PR head does not produce a new `ReviewRouter review review-request-...` run for the same PR. The request shows as stopped in History.
- A run that concludes `failure`, `timed_out` or `startup_failure` before authorization (for example the current `403 forbidden` on `review_run_authorize`) is redispatched at most `REVIEW_ROUTER_REVIEW_V2_INTENT_MAX_DISPATCH_ATTEMPTS - 1` times. With the defaults (3 attempts, 30 s base) the successors wait 30 s and then 60 s; larger attempt limits keep doubling up to a one hour cap.
- A completed run that GitHub reports without a conclusion is not classified; the request waits and is terminalized at its authorization deadline as before.
- A stopped request cannot be resumed with GitHub "Re-run"; push a new commit or request a new review instead. This was already the case for superseded requests.
- Failure signals: new runs appearing 30-80 s after an operator cancellation, or redispatches spaced by a constant 30 s.
- Record the actual worker version/image, environment, operator and time below.

## Retry, partial completion, and rollback

Redeploying the previous worker image restores the old behavior: completed runs on an unchanged head are redispatched again regardless of conclusion. Requests stopped by the new worker stay stopped. No data needs to be reverted.

## Related links

- [PR #742](https://github.com/777genius/review-router-ai/pull/742).
- Code: `apps/worker/src/review-v2-intent-dispatcher.ts`, `packages/features/review-executions/src/application/use-cases/recover-review-requested-dispatches.ts`, `packages/features/review-executions/src/application/use-cases/review-requested-dispatch-policy.ts`.
- [Release process](../operations/07-environments-and-release-management.md).

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result            | Evidence | Next action                             |
| ------------ | -------------------- | ---------- | ---------------------- | ----------------------------------- | -------- | --------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | No rollout verified by this record. | None     | Include in the next authorized rollout. |

## Evidence log

2026-10-30: production moved to main `533c040de09d2609c8ebb44474812e2b35f0e7ea` (image `sha256:e1578f75207de943031a6652ab94318433ef311c85fcaa5a1428fef26d08227a`). Migrations through `000154` are applied (including `000152` and `000153`); full evidence is in the [Production rollout 2026-10-30](2026-10-30-production-rollout-533c040d.md). Task-specific checks were not run separately.
