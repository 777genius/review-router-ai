# Observation recovery and finalization deadline repairs

- Task ID: `2026-11-25-pr977-observation-recovery`.
- Goal: recover exact result retries without duplicate effects and preserve the
  authorization-bound deadlines for new adoption/finalization.
- Affected service: API; development architecture/fixture checks.
- Implementation PR: [#1003](https://github.com/777genius/review-router-ai/pull/1003),
  follow-up to [#977](https://github.com/777genius/review-router-ai/pull/977).
- Implementation reference: core checkpoint
  `ce0d75ff32e6f7a7f28ccb7ab23d48eade791081`, based on
  `919a5add21a40d9adee064bf23b2e4217bd7e040`; not yet a release reference.
- Dependencies: none beyond the normal qualified application release.
- Last updated: `2026-11-25`.

This bounded follow-up to #977 repairs exact observation retry handling and
deadline checks during adoption/finalization. The source baseline is
`919a5add21a40d9adee064bf23b2e4217bd7e040`; see the
[review and qualification plan](../plans/2026-11-25-pr977-post-merge-correctness.md).

## Environment status

| Environment | Status    | Actual deployed version / image | Last verified (UTC) | Next step                                                            |
| ----------- | --------- | ------------------------------- | ------------------- | -------------------------------------------------------------------- |
| staging     | `pending` | Not verified                    | Not verified        | Include the merged implementation in a later authorized API release. |
| production  | `pending` | Not verified                    | Not verified        | Include the merged implementation in a later authorized API release. |

`pending` records no verified rollout completion; it is not evidence about the
currently installed fleet. This review does not authorize an application deploy.

## Applicability and prerequisites

Ordinary API code rollout using the normal signed release process. No schema
migration, new flag, environment change, provider rollout, public Action source
change or worker policy change is required. The architecture/provider-fixture
oracle repairs and disposable E2E reset correction affect development checks
only. Merge and automatic artifact
publication do not by themselves establish an application rollout.

Before an authorized rollout, identify the exact signed release containing this
implementation, reconcile applicable deployment records and inspect the actual
API fleet. Use the existing
[release procedure](../operations/07-environments-and-release-management.md).
No separate migration or feature activation is applicable.

## Ordered rollout

1. Qualify the exact release through the existing release gates.
2. Perform the ordinary API rollout through the standard release procedure.
3. Verify API health, fleet image identity and the behavioral checks below; record
   each environment's actual version and evidence separately.

## Verification and completion

Verify that an exact fresh-result retry restores the accepted observation; a
concurrent identical adoption returns the same accepted result without an extra
lease/ref/effect; and changed replay intent remains rejected. Confirm that a new
adoption/finalization cannot pass an expired deadline after external awaits or
database lock waits. Preserve already-issued permit reconciliation behavior.

Use the normal API health and release checks. If rollback is needed, restore the
prior qualified application image through the standard release procedure; there
is no schema/data rollback for this change. No production rollout was requested
or performed as part of the review.

## Retry, partial completion, and rollback

Inspect the installed API release before resuming any rollout; do not relabel
local or CI results as production evidence. Restore the prior qualified API
image through the normal rollback procedure if necessary. No data conversion or
destructive cleanup is needed, and durable observation/artifact identities must
be preserved.

## Qualification evidence

The [local qualification record](evidence/2026-11-25-pr977-observation-recovery.json)
binds the source files and preserves passing and failed attempts separately.
It includes the 150-case API/domain suite, 56-case real PostgreSQL suite, full
18-case production-source E2E pass, and the later local process interruption.
The exact-head required CI, merge readback and main checks are tracked on
[PR #1003](https://github.com/777genius/review-router-ai/pull/1003). These are source
qualification records, not staging or production deployment evidence.

## Related links

- [Review and qualification plan](../plans/2026-11-25-pr977-post-merge-correctness.md).
- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).

## Execution log

| Time (UTC)   | Environment | Operator   | Actual version / image | Observed result                    | Next action                       |
| ------------ | ----------- | ---------- | ---------------------- | ---------------------------------- | --------------------------------- |
| Not executed | staging     | Unassigned | Not verified           | No rollout performed by this task. | Await a later authorized release. |
| Not executed | production  | Unassigned | Not verified           | No rollout performed by this task. | Await a later authorized release. |
