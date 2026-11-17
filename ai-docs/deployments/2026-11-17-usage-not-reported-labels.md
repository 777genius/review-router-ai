# Usage page: honest "not reported" labels and even filters: deployment

- Task ID: `2026-11-17-usage-not-reported-labels`
- Goal: the Usage page tells "not reported by the source" apart from partial
  data, shows one readable status per row ("N calls with incomplete token
  data"), labels OpenRouter `:free` models as "Free model", and renders the four
  filters (period, provider, model, route) evenly with the same text color.
- Affected services/targets: Web only (`apps/web` and the shared
  `@reviewrouter/ui` SelectField). No API, worker, database or Gateway change.
- Implementation PR/issue:
  [PR #882](https://github.com/777genius/review-router-ai/pull/882).
- Implementation reference: the branch head of that PR.
- Dependencies: none.
- Last updated: `2026-11-17`.

## Environment status

| Environment / target | Status      | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker                                                                        |
| -------------------- | ----------- | ------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| staging              | `pending`   | Not verified                    | Not verified        | Ship with the next ordinary Web release.                                                              |
| production           | `installed` | Web `974295ea`                  | 2026-11-17 17:51    | Shipped in the [coordinated rollout](2026-11-17-coordinated-rollout-974295ea.md); page check not run. |

`pending` means no verified completion is recorded. See the
[status contract](README.md#status-contract).

## Applicability and prerequisites

- Presentation-only change. Stored usage facts, projections, source revisions
  and report SQL are unchanged, so no migration, redrive or backfill applies.
- The change reads existing report fields only (`unknownCount`, `partialCount`,
  `unknownTotalTokenCount`, `unknownCostCount`, requested provider/model).

## Ordered rollout

1. Ordinary code deployment of the Web image through the
   [release process](../operations/07-environments-and-release-management.md).
2. No activation step.

## Verification and completion

- Usage page, Models tab: rows show "N calls with incomplete token data" (hover
  shows the source breakdown) instead of "0 unknown · 5 partial · ...".
- Gateway rows show "Observed: Not reported" and cost "Not reported"; an
  OpenRouter model ending in `:free` shows "Free model".
- Details > Daily values: "(partial day)" and "No usage recorded"; Raw
  observations latency reads "Not reported" instead of "Unknown / Unknown ms".
- The four filter selects have equal width and height and the same text color
  for "All ..." values; they wrap to 2 x 2 and then one column on narrow widths.

## Retry, partial completion, and rollback

Stateless Web change: redeploying the previous Web image is a full rollback.

## Related links

- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                  |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | ---------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed yet.        | None     | Include in next Web release. |
