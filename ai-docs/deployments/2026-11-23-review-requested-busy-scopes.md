# Allow due reviews past busy PR scopes: deployment

- Task ID: `2026-11-23-review-requested-busy-scopes`
- Goal: a full dispatch batch of reviews waiting behind already busy pull requests cannot hide an eligible review later in the queue.
- Affected services/targets: worker and API deployments using the review-requested dispatcher and store.
- Implementation PR: [#994](https://github.com/777genius/review-router-ai/pull/994); relates to the [`relay_saturated` review-reliability investigation](https://github.com/777genius/agent-teams-ai/pull/1266#issuecomment-7078993822).
- Implementation reference: `734212fa3` contains the reviewed implementation; local source and tests are not deployment evidence.
- Dependencies: none beyond the ordinary release and existing ReviewRequested schema. Existing scope index supports the blocker lookup; no migration, new configuration or flag.
- Last updated: `2026-11-23`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker                     |
| -------------------- | --------- | ------------------------------- | ------------------- | -------------------------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Reconcile target and ship exact qualified release. |
| production           | `pending` | Not verified                    | Not verified        | Reconcile target and ship exact qualified release. |

`pending` records no verified completion, not observed absence. The [status contract](README.md#status-contract) applies separately per environment.

## Applicability and prerequisites

Confirm the selected release contains the reviewed implementation and reconcile all applicable registry tasks and the actual fleet per the [release process](../operations/07-environments-and-release-management.md). No schema migration, activation, Gateway, native or Action change is required. Filtering is advisory: the transactional scope claim, fencing and authority remain the final decision.

## Ordered rollout

1. Qualify the exact source and reconcile deployed image, release prerequisites and pending task dependencies.
2. Perform the ordinary API/worker rollout using the release process; record source/image and timestamps.
3. In an isolated disposable fixture, hold ten PR scopes busy and verify that an eligible review behind them reaches dispatch once. Simulate a competing scope claim after listing and verify the transactional claim rejects the stale request. No real customer projects, provider inference, replay or forced cleanup.
4. Observe normal dispatch and conflict/queue health, then record verification evidence independently for each environment.

## Verification and completion

A busy scope must not consume the entire due batch; eligible work in another scope must be considered. The claim remains authoritative across replicas and cannot double-dispatch a scope. Previously blocked intents remain durable and become eligible after the blocker is terminal or expires. Local PostgreSQL and memory tests do not prove installed production behavior. This change alone does not guarantee tenant fairness, global capacity, post-expiry relay cleanup or the root cause of the original `relay_saturated` event.

## Retry, partial completion, and rollback

Before retrying, inspect actual versions, durable intents and previous rollout evidence. Use the release runbook to roll back the prior application image. Do not remove, cancel, replay or mutate customer intents solely to verify the change. No data conversion needs reversal.

## Related links

- [Release process](../operations/07-environments-and-release-management.md)
- [Quality gates](../operations/03-quality-gates.md)

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result                 | Evidence                             | Next action                                 |
| ------------ | -------------------- | ---------- | ---------------------- | ---------------------------------------- | ------------------------------------ | ------------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Local qualification only; no deployment. | `734212fa3`; CI and release pending. | Complete review, CI and authorized rollout. |
