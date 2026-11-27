# Production review failure diagnostics, GitHub waits and incomplete causes

- Task ID: `2026-11-27-production-review-failure-fixes`
- Goal: respect GitHub retry boundaries, identify the failed companion settlement
  operation and preserve finite incomplete-review causes through evidence and
  publication, without changing provider-effect or coverage semantics.
- Affected services/targets: ReviewRouter API, workers and evidence readers,
  consumers of its GitHub revision-read adapter, and the public Action.
- Implementation PR: [#1028](https://github.com/777genius/review-router-ai/pull/1028).
- Initial implementation reference: `dd17dc481b7d2dadbc62be734d2858de5c51da71`.
  The candidate also includes the later leap-second correction and custody
  regressions. Use the final PR head recorded in its description for exact-source
  qualification; the initial commit alone is not the final candidate.
- Dependencies: existing compatible runtime/producer, ordinary release gates.
  Native attested retry is still unimplemented. The public Action's separate
  GitHubClient source correction is tracked in [Action #411](https://github.com/777genius/review-router/pull/411),
  with its generated bundle and runtime qualification pending.
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
before an authorized rollout. There is no SQL migration, new feature flag or
budget increase. The existing quality-flags field gains three accepted values;
this semantic contract extension requires compatible API and worker readers
before the corresponding Action producer is activated.

Required evidence: focused GitHub transport and companion failure-injection
tests; relevant static/type/architecture checks; existing real PostgreSQL
admission/settlement and paired Action regression checks at the accepted source.
Draft CI aggregation with skipped lanes is not runtime qualification.

## Ordered rollout

1. Use the existing [release procedure](../operations/07-environments-and-release-management.md)
   after the normal source/review/CI gates. Record the exact source/image.
2. Deploy compatible ReviewRouter API and worker/evidence readers as one
   coherent batch. Existing producers remain compatible. Before any Action
   activation that emits the new causes, verify all readers accept the three
   new persisted values and record the compatible rollback floor.
3. In isolated staging fixtures, verify that GitHub waits do not precede either
   announced primary/reset boundary and that a wait outside the read deadline
   refuses without another read, including valid leap-second dates.
4. Inject status-read, usage-outcome and companion-settlement failures after
   stream EOF. Confirm the corresponding phase, allowlisted HTTP/category
   detail, uncertain settlement, no successful terminal and no additional model
   request. Verify a throwing diagnostic sink does not change cleanup.
5. Qualify retained-close pressure after all eight background retries and
   expired-credential refusal. An unconfirmed close retains the slot; an applied
   close before the original deadline permits the next admission. Preserve the
   original close identity and verify that inference is not repeated.
6. Qualify the rebuilt Action with the paired compiled-entrypoint/PostgreSQL
   fixture: a failed phase with full path coverage keeps its useful finding and
   publishes the finite reason; a preserved filter remains advisory. Require
   unchanged server work completion, partial producer coverage where applicable,
   and no baseline advancement for incomplete coverage.
7. Use the official protocol generator/check/export and Action bundle gates.
   Activate the qualified Action only after the reader-first prerequisite,
   through the separately authorized release process. Confirm healthy and
   partial reviews retain their existing progress outcomes before completion.

## Accepted incomplete-review causes

The closed values `review_main_incomplete`, `review_round_incomplete` and
`review_phase_incomplete` refine `context_inspection_incomplete`; none is
accepted or restored without that existing flag. They add no reuse penalty and
remain immutable attempt metadata. Retrying the same attempt with different
flags conflicts rather than rewriting its accepted observation.

The Action maps only finite classifications and structured phase states.
A failed filter with `filterDecisionValid: false` remains advisory even beside
an unrelated round, normalization or path gap. Genuine non-filter failures,
non-preserved filter failures and compression stops retain their phase cause.
Required accepted lanes contribute these causes to the existing localized
incomplete-summary section. Raw native prose remains local.

The wire field and envelope are unchanged; official generation and handoff
checks must establish the actual exported bytes. Tests and rebuilt artifacts
qualify source behavior separately from deployment or producer activation.

## Verification and completion

Use the [implementation acceptance matrix](../plans/2026-11-27-production-review-failure-implementation.md#acceptance-matrix).
Preserve secret-free evidence and actual versions separately per environment.

This correction improves RR behavior and attribution. It does not prove the
root cause of historical 502s, eliminate long GitHub quotas, qualify native
request retry, release unknown native custody or fix the public Action's
independent rate-wait parser.

## Retry, partial completion, and rollback

Ordinary code rollback follows the release runbook. Once the new cause values
are persisted, every retained API/worker rollback image must decode them; an
older reader that rejects these values is not a compatible rollback. There is
no SQL schema or destructive data rollback. Preserve spent dispatch claims,
unknown effects, retained native custody, partial findings and their causes.

Do not replay customer reviews or model requests to verify this change.
A retry of the original rejected native request remains prohibited by its
existing contract. Reconcile any partially installed fleet before resuming.

## Related links

- [PR #1028](https://github.com/777genius/review-router-ai/pull/1028)
- [Dependent Action #411](https://github.com/777genius/review-router/pull/411)
- [Historical incident investigation](../plans/2026-11-27-production-review-failure-investigation.md)
- [Attested request retry dependencies](../plans/2026-11-27-attested-request-retry.md)
- [Quality gates](../operations/03-quality-gates.md)

## Execution log

No staging or production rollout has been performed for this task. Source
changes, code review and tests must be recorded separately from deployment.
