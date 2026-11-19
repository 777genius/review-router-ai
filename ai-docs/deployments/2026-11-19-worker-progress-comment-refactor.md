# Worker progress comment refactor: deployment

- Task ID: `2026-11-19-worker-progress-comment-refactor`
- Goal: the worker that keeps the GitHub "review progress" comment up to date
  runs the split, claim-fenced publication flow from PR #821. Users should see
  the same progress comment as before, with fewer stuck or overwritten
  comments after retries, stale claims and busy pull requests.
- Affected target: worker only (the image that runs the review v2 publication
  and progress maintenance passes). Web, API, Gateway, native and the public
  Action are unchanged.
- Implementation: [ReviewRouter AI PR #821](https://github.com/777genius/review-router-ai/pull/821).
- Dependencies: none. No migration, no new configuration and no feature flag.
  The existing `REVIEW_ROUTER_PROGRESS_*` settings keep their meaning.
- Last updated: 2026-11-19.

## Environment status

| Target     | Status      | Actual image                         | Evidence                                                                                                                                          |
| ---------- | ----------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staging    | `pending`   | Not verified                         | Ordinary worker rollout and the checks below                                                                                                      |
| Production | `installed` | `7c176ef7`, image `sha256:a2c03f03…` | [rollout 7c176ef7](2026-11-19-rollout-7c176ef7.md) 2026-11-19 15:56 UTC. Dormant: hosted progress comment writes are off; see the rollout record. |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).
Merging the PR did not deploy anything.

## What changes at runtime

The behavior a user can notice stays the same, but the worker now:

- releases or repairs a progress claim when its write lost the claim fence, so
  an older write cannot leave a newer progress state unpublished;
- skips (defers) an unavailable publication and keeps going through the rest of
  the batch instead of stopping the pass;
- promotes progress to its final state only after the publication attempt is
  fully settled in the database;
- validates the progress snapshot and GitHub pagination headers more strictly
  and defers instead of creating a duplicate comment when a scan is not
  conclusive. On PRs with more comments than the scan limit, the stored
  progress comment is still updated in place, as before.

## Applicability and rollout

1. Confirm the selected worker image contains the merged change, then roll it
   out through the existing worker release path in the
   [release procedure](../operations/07-environments-and-release-management.md).
   Ordinary code rollout is sufficient; old and new workers can overlap during
   the drain because the claim columns and their meaning are unchanged.
2. Run one review on a disposable PR and check that the progress comment is
   created once, updates while the review runs and ends in its final state.
3. Watch `lastErrorCode` on `ReviewProgressPublicationV1` (these codes are not
   logged), in particular `review_progress_snapshot_invalid` and
   `review_progress_pagination_inconclusive`, and the worker log line
   `ReviewRouter worker phases failed` for `review_v2.progress_*` phases. A new
   burst of either one is a rollback signal. Enabling the dormant flag follows
   the [enablement runbook](../operations/15-progress-comments-enablement-runbook.md).
4. Record the actual image/version, timestamp and evidence separately for each
   environment.

## Retry and rollback

No data is migrated. Rolling back is an ordinary worker image rollback; rows
written by the new worker (a `review_progress_repair_*` marker in
`lastErrorCode`, released claims) are read correctly by the old worker. Record
any rollback as `rolled_back` with the previous image.

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                            |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | -------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Merged, not deployed     | PR #821  | Roll out with the next worker release. |
