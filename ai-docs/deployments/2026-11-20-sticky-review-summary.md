# One review summary comment per pull request: deployment

- Task ID: `2026-11-20-sticky-review-summary`
- Goal: a pull request keeps one ReviewRouter summary comment. Every new review
  run rewrites that comment in place instead of posting another one, so a busy
  pull request no longer collects dozens of summaries.
- Affected targets: worker only (the GitHub App publication client in
  `packages/features/review-publishing/src/v2`). Web, API, Gateway, native and
  the public Action are unchanged; no Action release is needed.
- Implementation: [ReviewRouter AI PR "Keep one review summary comment per pull request"](https://github.com/777genius/review-router-ai/pulls?q=is%3Apr+sticky-review-summary).
- Implementation reference: the squash commit of that PR on `main`; this is not
  proof that it is selected for a release or installed.
- Dependencies: none. No migration and no configuration.
- Last updated: 2026-11-20.

## Environment status

| Target     | Status    | Actual image | Evidence                                                                     |
| ---------- | --------- | ------------ | ---------------------------------------------------------------------------- |
| Staging    | `pending` | Not verified | Ordinary worker rollout and the checks below                                 |
| Production | `pending` | Not verified | Not deployed. Rides in the next bundled rollout, not on its own (2026-11-20). |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).
Merging the PR did not deploy anything.

## What changes at runtime

- Cause: the runtime marks each summary with
  `reviewrouter:summary:v2:<reviewRevisionHash>`, and the revision hash changes
  with every head or base move. The worker looked the marker up and found
  nothing for a new revision, so it posted a new comment every time
  (55 summaries on social-monitor#665 on 2026-11-20).
- Now, when the summary carries that marker family, the worker scans all
  issue comment pages for summaries authored by the App bot, rewrites the
  newest one and posts a new comment only when there is none. Older per-run
  summaries stay as they are.
- A stale run that has to retract its summary deletes the comment only while
  it still shows that run's own marker, so it never removes a newer run's
  summary.
- Inline finding comments, their markers and their deduplication are unchanged.

## Ordered rollout

Ordinary worker rollout through the
[release process](../operations/07-environments-and-release-management.md).
No migration, drain or activation step. A publication that is in flight during
the swap finishes on the old or the new worker; both settle on the same marker.

## Verification and completion

1. Push a commit to a pull request that already has a ReviewRouter summary.
2. The newest App summary comment is edited (its "edited" label and new
   content appear); no new summary comment is added.
3. A pull request without any summary gets exactly one new comment.
4. Worker logs show no `github_summary_comment_lookup_failed` storm.

## Retry, partial completion, and rollback

Rolling back the worker restores one new comment per run; comments written by
the new worker stay valid for the old one. Nothing to clean up.

## Related links

- [Release process](../operations/07-environments-and-release-management.md)
- [Quality gates](../operations/03-quality-gates.md)

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                   |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | ----------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed yet.        | None     | Ship in the next bundled one. |
