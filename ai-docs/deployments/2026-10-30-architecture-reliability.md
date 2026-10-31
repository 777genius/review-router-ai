# Architecture and reliability refactor: deployment

- Task ID: `2026-10-30-architecture-reliability`.
- Goal: preserve identity ownership and settings/audit consistency, prevent stale outbox dispatch and publication starvation, and let independent worker work continue with honest failure reporting.
- Affected services/targets: Web, API, ordinary worker and Skills scanner worker; shared feature packages and CI architecture checks.
- Implementation PR: [PR #747](https://github.com/777genius/review-router-ai/pull/747).
- Implementation reference: [`dd5ddbf6c1f64762e501632474f07173b83e9c48`](https://github.com/777genius/review-router-ai/commit/dd5ddbf6c1f64762e501632474f07173b83e9c48). This is the reviewed implementation snapshot, not a merged, released or installed version. Record the selected release SHA/image separately.
- Dependencies: no new migration, configuration, feature flag, activation or cutover for this task. Reconcile applicable earlier tasks and schema/fleet holds from the installed-to-selected release range.
- Last updated: `2026-10-30`.

## Environment status

| Environment / target                     | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker                                                              |
| ---------------------------------------- | --------- | ------------------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| staging: Web/API/worker/Skills worker    | `pending` | Not verified                    | Not verified        | Select an authorized release, reconcile the fleet and complete verification below.          |
| production: Web/API/worker/Skills worker | `pending` | Not verified                    | Not verified        | Reconcile actual state and applicable release gates before the authorized coherent rollout. |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).
This task records no deployment attempt and does not authorize one.

## Applicability and prerequisites

The selected release must contain all six implementation directions:

| Direction                              | Owner and delivered behavior                                                                                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Outbox execution ownership          | `features-outbox` acquires work immediately before execution, confirms the current persisted claim, owns heartbeat settlement and bounds the drain.                                             |
| B. Atomic identity resolution          | `features-auth` resolves User and external identity in one ReadCommitted transaction, preserving the persisted owner and composing with the existing installation-owner writer.                 |
| C. Settings audit and GitLab admission | Review-config commits the requested settings/version and audit together, derives reserved facts from saved state, and applies the existing mutation gate before GitLab installation writes.     |
| D. Publication due-work ownership      | Review-publishing applies complete eligibility and repository scope before its ordered limit, preserving retry CAS and reconciliation discovery.                                                |
| E. Nested architecture coverage        | The existing import guard recognizes nested feature layers without changing the prohibited-import policy or claiming transitive conformance.                                                    |
| F. Worker phase isolation              | Independent maintenance phases continue after another phase fails; failed/blocked work remains unavailable, publication/progress dependencies remain explicit, and degraded one-shot runs fail. |

- Use the [release process](../operations/07-environments-and-release-management.md) and [quality gates](../operations/03-quality-gates.md). Check the selected release's actual CI, build, compiled runtime smoke and applicable release evidence; a local test run or green PR alone is not deployment evidence.
- Source qualification at the implementation snapshot is recorded in the [plan](../plans/2026-10-30-architecture-reliability-refactor.md). Full architecture qualification passed on that snapshot.
- A previous PR head passed required Quality Gates, compiled API/worker smoke, Web smoke, PostgreSQL contract checks, self-hosted E2E and hosted OCI image build. Historical results do not replace required exact-head CI for the selected release.
- The optional private full PG16-to-PG17 rehearsal was skipped by its existing condition; its execution is not claimed. These results are source qualification, not proof that the release was deployed.
- Existing database schema, configuration and enabled capabilities remain prerequisites. This task adds no migration, backfill, flag, credentials, deployed Action or review-workflow change, or activation command. Its CI environment wiring is recorded separately in the rollout checks and plan. Earlier pending cutovers in the selected release retain their own requirements.
- During a mixed fleet, old identity writers do not honor the new cooperative identity lock, and old outbox consumers can still reserve serial batches and start stale handlers. Replace every relevant replica and drain old processes through the ordinary deployment lifecycle before claiming fleet-wide behavior. Include the Skills worker because it consumes the shared outbox processor.
- Keep existing claim fencing, recovery, provider onboarding and App-authored publication contracts. Discovery is not mutation authority, and this rollout does not establish exactly-once external effects.

## Ordered rollout

Ordinary coherent code deployment is sufficient for this task. Follow the
[existing release path](../operations/07-environments-and-release-management.md#self-hosted-control-plane-runtime-release)
and its environment gates rather than introducing a separate deployment flow.

1. For the authorized environment, record the selected release/source/image and current Web/API/worker/Skills worker versions. Inspect unfinished registry entries and the installed-to-target change range; complete any applicable earlier prerequisites using their owning runbooks.
2. Confirm required source, CI, production build and compiled runtime gates for that exact release. In the existing CI quality job, auth and publication fixtures use their explicit disposable PostgreSQL admin environments; publication SQL compatibility also runs against the migrated ordinary test schema.
3. Deploy the coherent Web, API, ordinary worker and Skills scanner worker build through the existing process. Record each actual target version and old-process drain status. Reconcile retained/in-flight claims through normal fencing and recovery rather than rewriting event state or replaying external effects manually.
4. Complete the environment-specific checks below, inspect startup and safe named worker failures, and record durable deployment/check references. No task-specific after-code activation or cutover applies.
5. Mark only the verified environment `deployed`; update this task and index together. Production requires its own actual versions and checks even after staging succeeds.

## Verification and completion

- **Fleet and runtime:** all four targets run the selected build, old replicas have drained, and the compiled API/worker runtime starts successfully. Inspect existing health, startup and webhook/session/configuration error signals.
- **Identity:** disposable same-ID concurrent login tests converge on one persisted owner, installation-before-login reuses the immutable GitHub owner, profile updates retain that owner, and injected persistence failures roll back both writes. Historical conflicting or noncanonical bindings remain fail-closed; no automatic account merge or orphan cleanup is implied.
- **Outbox:** competing-worker tests leave unstarted work available, suppress dispatch after a takeover or failed ownership confirmation, and await heartbeat settlement on success and failure. Existing retry, dead-letter, reconciliation preservation and scanner recovery lanes still pass. A failed ownership check leaves normal recovery responsible for the claim.
- **Settings and admission:** save/clear emits exactly the requested audit event with the committed version/provider facts; implicit workspace creation adds no extra settings event. Absent provider facts do not preserve stale caller values. Denied/CAS or injected audit failures commit neither the write nor audit. Disabled GitLab mutation refuses before installer/persistence work.
- **Publication:** the PostgreSQL regression returns eligible tail work behind more than four times the batch limit of earlier expired attempts. Scope/provider filtering, exact ordering, due/retention equality, the 1000-row cap and durable retry CAS pass. Expired reconciliation windows remain discoverable under the existing executor policy.
- **Worker failures:** bounded fault tests show later independent owners run, successful outbox counters survive unrelated failures, unavailable metrics remain explicit, and configured publication failure blocks progress promotion/publication for that pass. Named errors are sanitized, normal error pacing remains, and a degraded one-shot run returns failure. Do fault injection only in disposable tests/staging fixtures, not production data.
- **Architecture and CI:** the nested-boundary rejecting fixtures and full existing architecture command pass; auth/publication PostgreSQL suites execute rather than skip in CI. This proves their scoped contracts, not repository-wide DDD/SOLID or production behavior.

Local integrated regression evidence is source qualification only: at exact
`dd5ddbf6`, 40 files contained 534 cases: 531 passed, none failed and three
existing dedicated-fixture cases were skipped. The plan identifies those
exclusions. Capture actual environment, operator, UTC time, release/image and
durable deployment/verification references below before completion.

## Retry, partial completion, and rollback

Before resuming, inspect actual service versions, remaining old replicas,
in-flight claims and the previous attempt's recorded phase failures. Resume
only missing deployment/check steps under the existing runbook; do not infer a
successful batch from a completed unrelated phase or manually repeat an
effectful publication/settings/provider action.

Use the [rollback procedure](../operations/07-environments-and-release-management.md#rollback).
An API replacement still requires the target build's
[protocol preflight](../operations/07-environments-and-release-management.md#api-rollback-protocol-preflight)
for the current channel and active runs. Roll back the coherent affected fleet
to an approved compatible image, or fix forward. This task has no schema revert,
backfill reversal or activation toggle; retain identities, settings versions,
audits, claims and publication receipts. Code rollback restores the earlier
identity race, stale-dispatch, starvation and phase-failure risks, so record that
loss of protection and the follow-up before another attempt.

## Related links

- [Implementation PR #747](https://github.com/777genius/review-router-ai/pull/747) and [plan/outcomes](../plans/2026-10-30-architecture-reliability-refactor.md).
- Pinned implementation: [outbox batch](https://github.com/777genius/review-router-ai/blob/dd5ddbf6c1f64762e501632474f07173b83e9c48/packages/features/outbox/src/application/use-cases/process-outbox-batch.ts), [identity adapter](https://github.com/777genius/review-router-ai/blob/dd5ddbf6c1f64762e501632474f07173b83e9c48/packages/features/auth/src/infrastructure/prisma/prisma-user-repository.ts), [settings owner](https://github.com/777genius/review-router-ai/blob/dd5ddbf6c1f64762e501632474f07173b83e9c48/packages/features/review-config/src/application/use-cases/manage-provider-selections.ts), [GitLab admission](https://github.com/777genius/review-router-ai/blob/dd5ddbf6c1f64762e501632474f07173b83e9c48/apps/web/app/api/dashboard/gitlab/install/route.ts).
- Pinned implementation: [publication feed](https://github.com/777genius/review-router-ai/blob/dd5ddbf6c1f64762e501632474f07173b83e9c48/packages/features/review-publishing/src/v2/infrastructure/prisma/prisma-review-publication-work-feed.ts), [architecture guard](https://github.com/777genius/review-router-ai/blob/dd5ddbf6c1f64762e501632474f07173b83e9c48/scripts/check-architecture-boundaries.mjs), [worker batch](https://github.com/777genius/review-router-ai/blob/dd5ddbf6c1f64762e501632474f07173b83e9c48/apps/worker/src/worker-batch.ts), [review-v2 maintenance](https://github.com/777genius/review-router-ai/blob/dd5ddbf6c1f64762e501632474f07173b83e9c48/apps/worker/src/review-v2-worker-runtime.ts), [CI environment wiring](https://github.com/777genius/review-router-ai/blob/dd5ddbf6c1f64762e501632474f07173b83e9c48/.github/workflows/ci.yml).
- [Release process](../operations/07-environments-and-release-management.md), [quality gates](../operations/03-quality-gates.md), [deployment registry](README.md).

## Execution log

| Time (UTC)   | Environment | Operator   | Actual version / image | Step and observed result            | Evidence | Next action                                                  |
| ------------ | ----------- | ---------- | ---------------------- | ----------------------------------- | -------- | ------------------------------------------------------------ |
| Not executed | staging     | Unassigned | Not verified           | No rollout verified by this record. | None     | Select an authorized release and reconcile actual state.     |
| Not executed | production  | Unassigned | Not verified           | No rollout verified by this record. | None     | Complete applicable release gates, rollout and verification. |
