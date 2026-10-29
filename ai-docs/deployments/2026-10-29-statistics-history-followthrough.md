# Trusted Statistics and Usage reports: deployment

- Task ID: `2026-10-29-statistics-history-followthrough`.
- Goal: retain safe authenticated report scopes, usable filters and pagination
  after errors, and a correct route from a Statistics issue to its recorded PR
  history; reduce repeated Usage policy lookups without changing accounting.
- Affected services/targets: Web and the compiled History/Statistics/Usage
  feature consumers included in the selected release.
- Implementation PR: [#743](https://github.com/777genius/review-router-ai/pull/743).
- Implementation reference: implementation in progress; the accepted plan was
  published first as `625855482368ac187c213e84883824f64a61a3cb`. Record the final
  implementation and selected release hashes before rollout.
- Dependencies: existing Statistics schema/capture and
  [Review History](2026-10-28-review-history.md) for optional history links.
  Missing History capture remains a supported absent-history state.
- Last updated: `2026-10-29`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step                                                      |
| -------------------- | --------- | ------------------------------- | ------------------- | ------------------------------------------------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Select and qualify the coherent release, then ordinary code rollout.      |
| production           | `pending` | Not verified                    | Not verified        | Reconcile installed state and follow the release process when authorized. |

`pending` records the absence of rollout evidence for this task. PR checks,
browser fixtures and a merge do not establish that an environment is deployed.

## Applicability and prerequisites

Verify that the selected release contains the final implementation and passed
its required checks. Reconcile actual schema and fleet state against all
applicable deployment records, following the
[release process](../operations/07-environments-and-release-management.md).
This change adds no migration, dependency, environment setting or feature flag.
Existing History capture is not enabled or backfilled by this task.

The Statistics HTTP report/issues and Usage responses gain web-owned scope
metadata. Ship routes, SSR hosts and their client bundles coherently. Previously
loaded dashboard clients may need a normal page reload after the release; do
not serve an old client build as the new server build's static assets.

## Ordered rollout

1. Complete the selected release's normal backup, schema and fleet prerequisites.
   This task needs no separate before-code conversion or activation step.
2. Deploy the Web build and coherent compiled feature consumers through the
   existing release path. Record the actual commit/image and rollout evidence.
3. Verify the changed report journeys using authorized test accounts in this
   environment, then record the result before wider rollout.

## Verification and completion

- Statistics shared URLs load the selected period/severity; Back and Forward
  restore them. Invalid URLs offer Reset, and ordinary failures preserve filters
  and Previous where a prior page exists.
- A revoked account cannot recover cached private labels through navigation.
  Restored access requires a fresh authorized scope. Usage role downgrade shows
  only the member's allowed report after refresh, without a stale admin frame.
- A recorded issue opens the correct repository/PR in Reviews with all relevant
  runs. Absent or temporarily unavailable History keeps the external PR action
  and distinguishes those states without disclosing internal errors.
- Report time is labeled as generation time. Coverage remains factual; no
  freshness watermark is asserted. Usage totals retain prior accounting.
- Monitor ordinary web error rates and latency. Keep exact versions, operator,
  UTC time and durable verification links in the execution log.

## Retry, partial completion, and rollback

Inspect the installed image, failed step and logs before retrying. Ordinary
deployment retry and rollback follow the release source of truth; roll Web
routes and client assets back coherently. This task needs no data rollback and
does not delete or rewrite ledger rows. Preserve unrelated environment work and
earlier migration/capture requirements. Record a partial or reverted rollout
without treating one successful environment as evidence for another.

## Related links

- [Accepted plan](../plans/2026-10-29-statistics-history-followthrough.md).
- [Five plan reviews and implementation evidence](../plans/2026-10-29-statistics-history-followthrough-reviews.md).
- [Browser qualification](../../scripts/statistics-e2e/README.md).
- [Usage policy measurement](../../scripts/provider-usage-e2e/README.md).
- [Quality gates](../operations/03-quality-gates.md).

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Observed result                                                     | Evidence | Next action                                               |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------------------------------------------------- | -------- | --------------------------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Implementation and qualification in progress; no rollout attempted. | PR #743  | Complete implementation and select an authorized release. |
