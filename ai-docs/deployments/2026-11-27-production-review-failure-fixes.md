# Production review failure diagnostics and GitHub read waits

- Task ID: `2026-11-27-production-review-failure-fixes`
- Goal: respect GitHub retry boundaries and identify the failed companion
  settlement operation without changing provider-effect or coverage semantics.
- Affected services/targets: ReviewRouter API and consumers of its GitHub
  revision-read adapter.
- Implementation PR: [#1028](https://github.com/777genius/review-router-ai/pull/1028).
- Implementation reference: `dd17dc481b7d2dadbc62be734d2858de5c51da71`.
  This identifies runtime source, not completed qualification or deployment.
- Dependencies: existing compatible runtime/producer, ordinary release gates.
  Native attested retry and the public Action's separate GitHubClient change are
  not part of this implementation.
- Last updated: `2026-11-27`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step                                                   |
| -------------------- | --------- | ------------------------------- | ------------------- | ---------------------------------------------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Qualify final PR source, then use the ordinary authorized release path |
| production           | `pending` | Not verified                    | Not verified        | Staging acceptance and ordinary release prerequisites remain required  |

Pending does not assert that older related changes are absent. This task does
not grant deployment permission.

## Applicability and prerequisites

The release must contain the rate-wait correction and companion diagnostic
changes from this PR. Reconcile fleet version and existing unfinished tasks
before an authorized rollout. There is no migration, configuration activation,
new feature flag, budget increase or new protocol capability.

Required evidence: focused GitHub transport and companion failure-injection
tests; relevant static/type/architecture checks; existing real PostgreSQL
admission/settlement and paired Action regression checks at the accepted source.
Draft CI aggregation with skipped lanes is not runtime qualification.

## Ordered rollout

1. Use the existing [release procedure](../operations/07-environments-and-release-management.md)
   after the normal source/review/CI gates. Record the exact source/image.
2. Deploy the compatible ReviewRouter code as one coherent batch. No data
   conversion or activation step is needed.
3. In isolated staging fixtures, verify that GitHub waits do not precede either
   announced primary/reset boundary and that a wait outside the read deadline
   refuses without another read.
4. Inject status-read, usage-outcome and companion-settlement failures after
   stream EOF. Confirm the corresponding phase, allowlisted HTTP/category
   detail, uncertain settlement, no successful terminal and no additional model
   request. Verify a throwing diagnostic sink does not change cleanup.
5. Confirm healthy and partial reviews retain their existing publication and
   progress outcomes. Record evidence before considering production complete.

## Verification and completion

Use the [implementation acceptance matrix](../plans/2026-11-27-production-review-failure-implementation.md#acceptance-matrix).
Preserve secret-free evidence and actual versions separately per environment.

This correction improves RR behavior and attribution. It does not prove the
root cause of historical 502s, eliminate long GitHub quotas, qualify native
request retry, release unknown native custody or fix the public Action's
independent rate-wait parser.

## Retry, partial completion, and rollback

Ordinary code rollback uses the retained preceding compatible image and the
release runbook. There is no schema/data rollback. Preserve spent dispatch
claims, unknown effects, retained native custody and partial findings.

Do not replay customer reviews or model requests to verify this change.
A retry of the original rejected native request remains prohibited by its
existing contract. Reconcile any partially installed fleet before resuming.

## Related links

- [PR #1028](https://github.com/777genius/review-router-ai/pull/1028)
- [Historical incident investigation](../plans/2026-11-27-production-review-failure-investigation.md)
- [Attested request retry dependencies](../plans/2026-11-27-attested-request-retry.md)
- [Quality gates](../operations/03-quality-gates.md)

## Execution log

No staging or production rollout has been performed for this task. Source
changes, code review and tests must be recorded separately from deployment.
