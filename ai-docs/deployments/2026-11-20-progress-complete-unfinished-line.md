# Complete progress comment without an unfinished-parts line: deployment

- Task ID: `2026-11-20-progress-complete-unfinished-line`
- Goal: a progress comment that ends as Complete no longer also says "Parts
  that could not be finished: N". The line stays while a review runs and on
  Complete with gaps and Failed.
- Affected target: worker (the comment formatter in
  `packages/features/review-progress`). Web, API, Gateway, native and the
  public Action are unchanged.
- Implementation PR: the PR that adds this file; seen on social-monitor#782
  after the bundled rollout `9ee93eb1`.
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

The terminal state was already right: the execution's coverage verdict marks
the review Complete. The line counted every exhausted unit, also an optional
part or a failed reviewer replaced by an ordered fallback, and neither leaves a
gap. Only the text of new comment versions changes; existing comments are
rewritten only when their review publishes a new version.

## Applicability and rollout

Ordinary worker rollout through the
[release procedure](../operations/07-environments-and-release-management.md).
Check one Complete comment on the canary after the rollout.

## Retry and rollback

No data is migrated. Rolling back the image restores the old line.

## Related links

- [Progress terminal promotion and retries](2026-11-20-progress-terminal-promotion-retry.md)
- [Release process](../operations/07-environments-and-release-management.md)

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                              |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | ---------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed             | This PR  | Ship in the next bundled worker rollout. |
