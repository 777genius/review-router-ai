# Scale and recovery: deployment

- Task ID: `2026-11-27-scale-and-recovery`.
- Goal: bounded resource use and recovery from component failures without
  restarting otherwise healthy services.
- Affected targets: the published slice changes Web provider-key ingress and
  public model catalog consumers. The complete planned batch also affects API,
  ordinary worker, skill worker and runtime database clients.
- Implementation: [Draft PR #1021](https://github.com/777genius/review-router-ai/pull/1021).
- Published production reference:
  [`3cb28a1456d110215cf6ae0a35fc58e1881ae98d`](https://github.com/777genius/review-router-ai/commit/3cb28a1456d110215cf6ae0a35fc58e1881ae98d).
  Later checkpoint changes correct a test observation and document interruption.
  None of these references proves merge, release selection or installation.
- Dependencies: preserve the already merged
  [multi-tenant reliability work](2026-11-25-multi-tenant-reliability.md);
  complete this task's implementation and qualification before release selection.
- Last updated: `2026-11-27`.

## Environment status

| Environment / target | Status | Actual deployed version / image | Last verified (UTC) | Evidence / next step |
| --- | --- | --- | --- | --- |
| staging | `pending` | Not verified | Not verified | Complete implementation and qualification; no rollout performed. |
| production | `pending` | Not verified | Not verified | Complete implementation and qualification; no rollout performed. |

Pending means no verified completion is recorded, not an observation that an
installation is absent. Use the [status contract](README.md#status-contract).

## Applicability and prerequisites

The Draft currently contains the plan and two narrow HTTP corrections:
streamed provider-key JSON is limited to 256 KiB through the existing reader;
rejected or oversized public-catalog responses abort transport and start body
cancellation without waiting forever for uncooperative cleanup.

The worker, database, native catalog, atomic webhook and remaining accounts work
is incomplete and not qualified. Do not release the planned guarantees on the
basis of the currently published slice. Review the
[plan and resume holds](../plans/2026-11-27-scale-and-recovery.md#7-actual-review--implementation-record)
before completing this record.

The published slice has no migration, configuration change, new service or
activation step. An installation-status index is conditional on a PostgreSQL
experiment and has not been designed or added. If justified later, amend this
record with its exact migration, lock/build cost and release order before rollout.

## Ordered rollout

1. Complete the implementation, cross-owner reviews, strict checks, real
   PostgreSQL/HTTP/worker failure qualification and authoritative CI on the exact
   selected commit. Keep current unknown effects and replay barriers intact.
2. When a release is separately authorized, reconcile the selected source and
   the current deployment registry through the
   [release process](../operations/07-environments-and-release-management.md).
   Ordinary code deployment is sufficient for the currently published HTTP slice.
3. For the complete batch, drain old workers before claiming the new graceful
   shutdown behavior; roll API/Web/worker through the ordinary release path.
   Perform any subsequently justified additive migration in its recorded order.
4. Verify actual versions and each applicable behavior below, then record
   per-environment evidence. This task does not authorize production changes.

## Verification and completion

Current local evidence: two focused suites, 18 tests passed on the published
production checkpoint. Those tests cover provider-key envelope compatibility,
oversize rejection and catalog rejection/recovery. Independent source review
found a test-observation issue: the loopback fixture watched request completion
rather than the unfinished response closing. The corrected response-close
assertion is pending execution after the environment outage.

The previous local result does not prove that corrected assertion, complete E2E,
SQL performance, worker recovery or the full planned batch. Main CI
[run 45928097736](https://github.com/777genius/review-router-ai/actions/runs/45928097736)
was queued at the last inspection; auxiliary skipped jobs are not passes.

For the HTTP slice, verify rejection of declared and streamed oversized request
bodies, acceptance of the maximum escaped key with 100 ordinary repository IDs,
unchanged authorization behavior, closure of a deliberately unfinished rejected
response and successful reads after restoration. Use disposable local fixtures;
never real provider credentials in tests or evidence.

Before complete-batch deployment, add actual results for retained worker
ownership/drain, runtime SQL cancellation and connection recovery, measured
installation-status SQL, same-process catalog recovery, immutable admission
policy, webhook rollback/redelivery and accounts final authorization. Capture
exact source/version, environment, operator, timestamp and evidence.
No complete-batch or deployed status is claimed now.

## Retry, partial completion, and rollback

Inspect actual source and environment state before resuming. Do not repeat an
uncertain external effect, reset historical processing receipts, or delete
outbox/audit records to make a recovery test pass. Recover and reconcile the
uncommitted checkout before replacing it; the plan lists the interrupted owners
and remaining integration holds.

The published HTTP changes are ordinary application changes and can follow the
existing application rollback procedure; rollback removes their resource bounds.
No migration has been added or applied. Amend rollback instructions if later
evidence introduces an additive index. Never rewrite historical migration
checksums or relabel old source-bound results as qualification of a new commit.

## Related links

- [Implementation plan](../plans/2026-11-27-scale-and-recovery.md).
- [Draft PR #1021](https://github.com/777genius/review-router-ai/pull/1021).
- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).

## Execution log

| Time (UTC) | Environment | Operator | Actual version / image | Step and observed result | Evidence | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-27 | Local qualification | Coding agent | Published production source `3cb28a1` | Two focused suites: 18 passed; independent review then corrected a response-close assertion. | Published tests and plan record | Re-run corrected tests after executor recovery. |
| Not executed | staging / production | Unassigned | Not verified | No rollout attempted; full implementation remains incomplete. | Draft PR and this record | Complete qualification before separately authorized rollout. |
