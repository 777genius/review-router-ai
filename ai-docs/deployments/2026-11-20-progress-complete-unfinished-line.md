# Complete progress comment without an unfinished-parts line: deployment

- Task ID: `2026-11-20-progress-complete-unfinished-line`
- Goal: a progress comment that ends as Complete no longer also says "Parts
  that could not be finished: N". The line stays while a review runs and on
  Complete with gaps and Failed.
- Affected target: worker (the comment formatter in
  `packages/features/review-progress`). Web, API, Gateway, native and the
  public Action are unchanged.
- Implementation PR: [PR #941](https://github.com/777genius/review-router-ai/pull/941);
  seen on social-monitor#782 after the bundled rollout `9ee93eb1`.
- Implementation reference: the squash commit of that PR on `main`.
- Dependencies: none. No migration, configuration or feature flag.
- Last updated: 2026-11-20.

## Environment status

| Target     | Status    | Actual image | Evidence                                                    |
| ---------- | --------- | ------------ | ----------------------------------------------------------- |
| Staging    | `pending` | Not verified | Ordinary worker rollout                                     |
| Production | `pending` | Not verified | Rides in the next bundled worker rollout; not deployed yet. |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## What changes at runtime

The terminal state was already right: the execution's coverage verdict
(`deriveCoverageState`) marks the review Complete. The line counted every
exhausted unit, also an optional part (on #782 the PR description, which is
always optional and was omitted) or a reviewer that another one covered
(ordered fallback, plan 67; quota skip, plan 69). Only the text of new comment
versions changes; existing comments are rewritten only when their review
publishes a new version.

This replaces the earlier choice in
[terminal promotion and retries](2026-11-20-progress-terminal-promotion-retry.md)
to keep "Parts that could not be finished" for a failed reviewer on Complete.
The hosted progress canary no longer checks that line on its final Complete
comment.

Known gap, not changed here: on a Complete fallback or quota-skip review with
file coverage, "Files fully reviewed" can still read below the total, because
file coverage counts a path only when every required part covering it was
accepted. That needs a capture-side rule and is a follow-up.

## Verification and completion

One Complete comment on the canary after the rollout shows no
"Parts that could not be finished" line; a Complete with gaps comment still
shows it. Record the image and time per environment below.

## Applicability and rollout

Ordinary worker rollout through the
[release procedure](../operations/07-environments-and-release-management.md).

## Retry and rollback

No data is migrated. Rolling back the image restores the old line.

## Related links

- [Progress terminal promotion and retries](2026-11-20-progress-terminal-promotion-retry.md)
- [Release process](../operations/07-environments-and-release-management.md)

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                              |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | ---------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed             | This PR  | Ship in the next bundled worker rollout. |
