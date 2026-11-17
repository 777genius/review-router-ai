# Usage and statistics audit fixes: deployment

- Task ID: `2026-11-17-usage-statistics-audit`
- Goal: the Usage page Details stop listing one "unknown" line per run, use
  the same incomplete-data wording as the tables, the Reset filters button also
  clears the Binding/Run filters typed in Details, the page stops re-reading
  the report every 30 seconds just because the Gateway never sends a cost, and
  the remaining "Unknown" labels for unreported values read "Not reported" or
  name the reason.
- Affected services/targets: Web only (`apps/web`). No API, worker, database,
  Gateway or native change.
- Implementation PR/issue:
  [PR #894](https://github.com/777genius/review-router-ai/pull/894), audit
  [72](../architecture/72-usage-statistics-audit.md).
- Implementation reference: merge commit `751238b91888d3ffa07b1ec1d4053b8393f5d6fa`
  on `main`, not in the 2026-11-17 rollout (`974295ea`); it ships with the
  second small release.
- Dependencies: none. Ships independently of the
  [not reported labels](2026-11-17-usage-not-reported-labels.md) task, ideally
  in the same Web release.
- Last updated: `2026-11-17`.

## Environment status

| Environment / target | Status      | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker                                          |
| -------------------- | ----------- | ------------------------------- | ------------------- | ----------------------------------------------------------------------- |
| staging              | `pending`   | Not verified                    | Not verified        | Ship with the next ordinary Web release.                                |
| production           | `installed` | Web `afa74c8f`                  | 2026-11-17 21:22    | Shipped in the [second rollout](2026-11-17-second-rollout-afa74c8f.md). |

`pending` means no verified completion is recorded. See the
[status contract](README.md#status-contract).

## Applicability and prerequisites

- Presentation-only change. Stored usage facts, projections, report SQL and the
  statistics read model are unchanged, so no migration, redrive or backfill.

## Ordered rollout

1. Ordinary code deployment of the Web image through the
   [release process](../operations/07-environments-and-release-management.md).
2. No activation step.

## Verification and completion

- Usage > Details: the summary line reads like the Models rows ("N calls
  without a usage report · M calls marked partial by the source ...").
- Usage > Details > delivery: only runtime sessions that reported a delivery
  loss get their own line; the rest are one line "No delivery loss reported by
  N runtime sessions".
- Typing a run ID in Details shows "Reset filters" next to the purpose switch;
  pressing it clears the run and binding filters too.
- With no token totals the "Known tokens" KPI and Cost-mode tooltips read
  "Not reported".
- A workspace whose calls are all reconciled (no "without a usage report" or
  "marked partial" calls) does not refetch the report every 30 seconds; the
  Refresh button stays "Refresh".

## Retry, partial completion, and rollback

Stateless Web change: redeploying the previous Web image is a full rollback.

## Related links

- [Audit 72](../architecture/72-usage-statistics-audit.md) with the open
  decisions that need the owner.
- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                  |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | ---------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed yet.        | None     | Include in next Web release. |
