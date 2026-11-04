# Workflow and publication ownership: deployment

- Task ID: `2026-11-04-foundation-ownership`.
- Goal: report setup attempt outcomes truthfully and apply the same publication
  lifecycle admission policy in API and worker; move setup persistence and
  publication execution into their existing feature owners.
- Affected services/targets: Web, API, ordinary worker and operator CLI.
- Implementation PR: [#810](https://github.com/777genius/review-router-ai/pull/810).
- Source plan: [foundation ownership refactor](../plans/2026-11-04-foundation-ownership-refactor.md).
- Implementation reference: select the final reviewed head/merge from #810.
  The initial A–C checkpoint is `e4327acd50dece733b3e2794497447f08eb10caf`;
  continuation D–F was authorized and planned at
  `cdd4037953e88322aca6d19592b18b0b2c274d32` and must be included in final
  qualification. Exact-head required CI and merge evidence are maintained in
  #810; none of these implementation references is a deployed version.
- Dependencies: existing workflow authority and resolution-history schema and
  accepted producer contracts; no new schema, configuration or activation step.
- Last updated: `2026-11-04`.

## Environment status

| Environment / target          | Status      | Actual deployed version / image | Last verified (UTC) | Evidence / next step                                                                                                                                                                         |
| ----------------------------- | ----------- | ------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| staging / Web, API, worker    | `pending`   | Not verified                    | Not verified        | Select an authorized exact release containing #810 and run the checks below.                                                                                                                 |
| production / Web, API, worker | `installed` | `d184d13e` / image `6d8d7f2d`   | 2026-11-04          | Four-role convergence and readiness verified; setup confirmations succeeded for three migrated installations. Remaining journey/fault-injection verification is not another code deployment. |

Production code installation is confirmed; full task-specific fault-injection qualification is not claimed. Staging remains pending. This task is an ordinary code rollout
record; it does not authorize deployment or imply that merging the PR deploys it.

## Applicability and prerequisites

Follow the existing [release process](../operations/07-environments-and-release-management.md).
Confirm that the selected shipping revision includes the complete reviewed PR
and its successful required checks. Reconcile the actual fleet and other
applicable deployment tasks before a rollout. No schema migration, backfill,
new environment variable, feature flag or provider enrollment is introduced.

API and worker must both contain the shared publication lifecycle resolver
before claiming uniform admission. Older workers retain their former
history-blind pre-effect policy, even while the existing transactional
resolution guard continues protecting database transitions. Web/API setup
callers likewise need the new outcome mapping together with the port change.
Operators using Hosted Pool connect should update the CLI from the same reviewed
batch so non-2xx responses retain uncertainty and any known committed PR.

The continuation changes package composition ownership without changing stored
records, signed capability formats or command identities. Ship the migrated
feature builds and their web/worker/tooling consumers together; do not copy an
individual host file into an older image. Existing in-flight publication claims,
receipts, recovery epochs and setup namespace evidence remain valid. Keep normal
draining and recovery instead of clearing state for the new implementation.

## Ordered rollout

1. Select the approved immutable release/image through the normal release
   process and record its exact source and checks. Include the public Action
   only where the existing release process requires the paired release; this
   change introduces no new Action ABI or installed workflow content.
2. Replace Web, API and worker using the existing fleet release path. Respect
   normal worker draining and possible-effect recovery; do not replay old
   operations or manually clear history/leases to accelerate convergence.
3. Confirm all three roles use the selected source/image and readiness is
   healthy. Confirm the installed operator CLI includes the new safe outcome
   projection when it is used. No task-specific migration or activation follows.
4. Verify setup status and a new approved disposable review. Record the real
   environment, operator, UTC time, source/image and durable evidence before
   marking that environment complete.

## Verification and completion

- Setup creation reports the PR that actually committed for the current
  attempt. Inspect its persisted attempt/revision and the shown PR link.
- In an isolated fixture, resume an obsolete attempt after a newer one wins:
  the older result is superseded, the newer PR remains authoritative, and the
  older attempt emits neither current success nor current failure audit.
- External-response uncertainty, persistence uncertainty and post-commit audit failure are distinguishable
  from an ordinary failed setup. A committed result remains visible and the
  user is directed to inspect/refresh, without an automatic new external PR.
- Setup recovery preserves pinned repository/default-branch/workflow/blob
  evidence and rechecks it around the same existing effect boundaries.
- A history-required publication is subject to the same lifecycle decision in
  API and worker. Foreign pending/confirmed history or unavailable required
  history cannot be silently admitted by the worker; exact own-operation
  recovery and receipt reconciliation still work.
- Discovery without mutation-eligible lifecycle targets remains usable.
  The aggregate-by-scope behavior and legacy snapshot compatibility remain as
  documented in the plan.
- Check normal review publication, final status and durable receipt/history
  state in an approved disposable repository. Fault injection and deliberate
  history corruption belong only in disposable fixtures, never production data.
- Confirm provider setup issuance, replay, recovery and workflow reattestation
  still honor the same locked repository identity and exact namespace fences.
  Verify the installer/ledger path through its existing approved setup flow.
- Verify interrupted publication resumes with the same persisted operation and
  capability identities, keeps reconciliation-only access restricted, and
  records the canonical receipt without an extra external publication.

Source tests and CI qualify implementation. Environment completion requires
observed deployed versions and these environment-specific checks. Synthetic
GitHub/PostgreSQL E2E is not a live provider or production deployment claim.

## Retry, partial completion, and rollback

Inspect actual role versions, the setup attempt row, known external PR and any
possible-effect/receipt/history evidence before retrying a failed rollout or
verification step. Do not repeat GitHub writes solely because an audit response
was unavailable. Preserve all current attempt identities and durable resolution
history; this task adds no cleanup or deletion step.

Use the existing [rollback procedure](../operations/07-environments-and-release-management.md#rollback)
and API protocol preflight. There is no schema downgrade. A code rollback
restores the previous misleading setup outcomes and diverging publication
admission; record that loss of protection. Keep all affected roles on a coherent
approved version, or fix forward after the required checks.

## Related links

- [Implementation PR #810](https://github.com/777genius/review-router-ai/pull/810).
- [Plan, scope and source qualification](../plans/2026-11-04-foundation-ownership-refactor.md).
- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).

## Execution log

| Time (UTC)   | Environment | Operator   | Actual version / image | Step and observed result                     | Evidence | Next action                               |
| ------------ | ----------- | ---------- | ---------------------- | -------------------------------------------- | -------- | ----------------------------------------- |
| Not executed | staging     | Unassigned | Not verified           | No staging rollout executed by this task.    | PR #810  | Select and qualify an authorized release. |
| Not executed | production  | Unassigned | Not verified           | No production rollout executed by this task. | PR #810  | Select and qualify an authorized release. |

### Production installation — 2026-11-04

Source `d184d13e56733586ba65d31aacb076d4eefbee7d` includes the complete #810 merge. The normal Hetzner build/swap/verify path installed image `sha256:6d8d7f2d164877676b55f6a8d2936780d902dae705ed1c3a1878e82af72b57ca` on all four roles, with no restarts, readiness200 and seven worker privilege checks passing. No schema changes or migration were required. All three installed-only Gateway confirmations completed through the real operator API and persisted configured workflow-v1 metadata. See [current delivery](2026-11-04-workflow-migration-action230.md). Historical pending log rows above describe the pre-installation state; do not repeat the rollout to close remaining journey verification.
