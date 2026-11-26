# Observation recovery and finalization deadline repairs

- Task ID: `2026-11-25-pr977-observation-recovery`.
- Goal: recover exact result retries without duplicate effects and preserve the
  authorization-bound deadlines for new adoption/finalization.
- Affected service: API; development architecture/fixture checks.
- Implementation PR: [#1003](https://github.com/777genius/review-router-ai/pull/1003),
  follow-up to [#977](https://github.com/777genius/review-router-ai/pull/977).
- Implementation reference: core checkpoint
  `ce0d75ff32e6f7a7f28ccb7ab23d48eade791081`, based on
  `919a5add21a40d9adee064bf23b2e4217bd7e040`; current-base integration
  `bfbece593a64232d934115755a5fc42de72ab56b` incorporates
  `95201f4e0d63d3ab7c4d585a1e55a6317e84ca6b`. These are not release references;
  later documentation-only integration `61ec1cb6` incorporates main `1912bb61`.
  The final correction and its source hashes are tracked by the PR/evidence.
- Dependencies: none beyond the normal qualified application release.
- Last updated: `2026-11-25`.

This bounded follow-up to #977 repairs exact observation retry handling and
deadline checks during adoption/finalization, including exact error mapping and
database-time validation before replayed permit issuance. The integrated source
baseline is `1912bb61b54de8af113e0dccd5d4a144382e19e2`; see the
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
oracle repairs, disposable E2E reset correction and bounded E2E retry scheduling
affect development checks only. Merge and automatic artifact
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
database lock waits. Expired new adoption must receive the existing HTTP 412
from the atomic store decision, while unrelated rejections retain their own
meaning. Database-time publication expiry must likewise return the existing
HTTP 410 `publication_permit_expired` without persisting finalization or masking
unrelated invariant errors. Permit issuance must respect both database and API
time and fail closed
when the database clock cannot be read; valid skew must preserve local token
verification. Preserve already-issued permit reconciliation behavior.

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
It preserves the original 150-case API/domain and 56-case real PostgreSQL
qualification, historical E2E/process failures, the later two consecutive
18-case E2E passes, and a separately bound qualification of the additional
clock/error-mapping corrections. The expanded API/domain suite passes 158/158.
The real PostgreSQL suite passes 56/56 again, and the bounded worker-drain helper
passes seven focused tests. Current full E2E and native compiler interruptions
are preserved as failed attempts; their exact-head CI gates remain required.
Subsequent full CI and related workflows passed at `97be9156`, including the
complete native compiler, real PostgreSQL execution 56/56 and source E2E 18/18.
A single ordinary Quality retry passed after the preserved exit-137 interruption.
The documentation-only `61ec1cb6` integration retained all those source inputs.
A later exact-head review required the precise database-expiry result and stronger
deadline assertions. That correction has new source bindings; previous passes do
not qualify it. Its original-scope CI is required before merge.
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
