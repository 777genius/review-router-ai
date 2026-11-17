# Reviewer roster mode (together or fallback in order): deployment

- Task ID: `2026-11-17-provider-interaction-mode`
- Goal: a workspace or repository reviewer roster can be set to "Together, in parallel" (unchanged default) or "Fallback in order". In fallback order only the first reviewer runs; the others are kept in order and are not started yet. Automatic switching on failure is a later delivery (see the plan).
- Affected services/targets: Web dashboard and API (shared `review-config`, `workflow-provisioning`). No database migration, runtime/Action, Gateway or native change.
- Implementation PR/issue: ReviewRouter AI PR (see the task index).
- Implementation reference: plan [67](../architecture/67-provider-interaction-mode.md).
- Dependencies: none.
- Last updated: `2026-11-17`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker              |
| -------------------- | --------- | ------------------------------- | ------------------- | ------------------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Ordinary Web and API rollout, checks below. |
| production           | `pending` | Not verified                    | Not verified        | No deployment authorized by the merge.      |

`pending` means no verified completion is recorded. Use the [status contract](README.md#status-contract).

## Applicability and prerequisites

- Web and API must run the same release: both read and write the stored policy documents and the shared `review-config` package.
- Existing policy documents and effective configurations of parallel rosters stay byte-identical, so no data conversion is needed.

## Ordered rollout

Ordinary code rollout through the [release procedure](../operations/07-environments-and-release-management.md) is sufficient. There is no migration, configuration change or activation step.

## Verification and completion

1. Providers > a workspace with two Gateway reviewers: "How reviewers work together" shows "Together, in parallel"; a review still runs both reviewers.
2. Switch to "Fallback in order", reorder with the arrows, save, reload: the order and mode are kept, the hint says only the first reviewer runs, the parallel limits are hidden.
3. Open a pull request in a repository that inherits this roster: the run admits one reviewer (the first in the saved order). Saving workspace review settings afterwards keeps the mode.
4. Switch back to "Together, in parallel": the saved parallel limits come back unchanged.

## Retry, partial completion, and rollback

All writes are normal dashboard saves and can be repeated. Run snapshots never contain the new field. Rolling back the code makes documents saved with "Fallback in order" unreadable to the old code (their targets ask for a resave). Before rolling back, trim such rosters to their first reviewer (behaviour is unchanged) or roll forward. Do not switch them to parallel as a rollback step: that starts every reviewer and multiplies provider usage.

## Related links

- [Plan 67](../architecture/67-provider-interaction-mode.md) and its review record.
- [Several Gateway reviewers plan](../plans/2026-10-28-gateway-multi-reviewers.md).
- [Release process](../operations/07-environments-and-release-management.md).
