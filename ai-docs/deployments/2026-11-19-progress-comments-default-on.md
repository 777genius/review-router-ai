# Live progress comment on by default: deployment

- Task ID: `2026-11-19-progress-comments-default-on`
- Goal: every repository gets the live ReviewRouter progress comment on its pull
  requests without any per-repository setup, and the comment reads in plain
  language ("Progress: 3 of 8 parts reviewed (37%)").
- Affected targets: worker (publisher, capture and settings) and API (capture
  and settings). Web, Gateway, native and the public Action are unchanged.
- Implementation: PR "Turn the live progress comment on by default" (number
  added to this record by the merge).
- Dependencies: [worker progress comment refactor](2026-11-19-worker-progress-comment-refactor.md)
  (#821, already installed on production). The backlog of old unpublished
  rows must be expired before the worker runs with writes on, see below.
- Last updated: 2026-11-19.

## Environment status

| Target     | Status    | Actual image | Evidence                                                                                                                     |
| ---------- | --------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Staging    | `pending` | Not verified | Ordinary worker and API rollout and the checks below                                                                         |
| Production | `pending` | Not verified | Not deployed. Ships in one bundled worker rollout with the next approved change, not on its own (owner decision 2026-11-19). |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).
Merging the PR did not deploy anything.

## What changes at runtime

One reader, `readReviewProgressSettings` in
`packages/features/review-progress/src/composition/review-progress-settings.ts`,
now owns these keys for the worker and the API:

| Key                                            | Unset or empty   | `0`                   | Other values                                                                                                  |
| ---------------------------------------------- | ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `REVIEW_ROUTER_PROGRESS_PROJECTION_CAPTURE`    | on               | off                   | invalid: off and a warning with the key name                                                                  |
| `REVIEW_ROUTER_PROGRESS_FILE_COVERAGE`         | on               | off                   | invalid: off and a warning                                                                                    |
| `REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES` | on               | off (the kill switch) | invalid: off and a warning                                                                                    |
| `REVIEW_ROUTER_PROGRESS_REPOSITORIES`          | every repository | -                     | `owner/repo,...` allow-list; a malformed entry (including `*`, empty entries) turns writes off with a warning |

`1` still means on. A malformed value never crashes the worker or API start;
the warning `Review progress settings are invalid; the affected progress
features stay off` names the keys, never the values. `*` is no longer special:
an empty value now means every repository.

The comment text is plain language. "Progress: N of M parts reviewed (P%)" and
the bar appear only with two or more required parts (98.6% of production
reviews in the last 60 days had one part, where the bar only jumped from 0% to
100%). File lines appear when coverage is valid, retry lines only when their
number is not zero, then "Started" (the execution start, a new optional
`startedAt` in the snapshot JSON, no migration) and "Last update". "How
progress is measured" is two sentences. The HTML marker and the source identity
marker are unchanged, so existing comments are found and edited in place.

Cadence: a phase change (or a new review taking over the PR comment) and every
terminal state are scheduled at once. Same-phase count updates wait
`progressCommentMinEditIntervalMs` (60 s) after the last edit. That constant
and the schedule rule live only in
`packages/features/review-progress/src/domain/progress-comment-cadence.ts`;
capture and the publisher both read it, so a cadence change is one line plus
its tests. `REVIEW_ROUTER_PROGRESS_MIN_MUTATION_INTERVAL_MS` (1 s) is a
different setting, the spacing between GitHub writes across one installation,
and still applies together with the claim fence and head checks.

Not built: progress by finished calls out of planned calls. The OCR calls are
not stored in the database and it is not verified that OCR knows the planned
count up front (follow-up in runbook 15).

## Production environment after rollout

Production today (runbook 15, section 2) has on the worker
`REVIEW_ROUTER_PROGRESS_PROJECTION_CAPTURE=1`, `REVIEW_ROUTER_PROGRESS_FILE_COVERAGE=1`,
`REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES=0` and
`REVIEW_ROUTER_PROGRESS_REPOSITORIES=777genius/review-router-saas-e2e`.
Because the explicit `0` wins, the new image alone keeps writes off.

To turn the comment on for every repository, remove these keys from the worker
and API env (they no longer need to be set):

- `REVIEW_ROUTER_PROGRESS_PROJECTION_CAPTURE`
- `REVIEW_ROUTER_PROGRESS_FILE_COVERAGE`
- `REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES`
- `REVIEW_ROUTER_PROGRESS_REPOSITORIES`

Kill switch: `REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES=0` on the worker,
then recreate the worker (the value is read at start).

Any role without the capture key starts capturing after the new image starts.
Capture runs inside the review execution transaction, as it already does on the
production worker.

## Ordered rollout

1. Expire the backlog first (operator task, no code): about 1,138 pending
   `ReviewProgressPublicationV1` rows from old reviews, most of them never get a
   terminal state. Without this step the publisher posts stale "Assembling
   results" or "Failed" comments on open PRs, including third-party
   repositories. Use the guarded `UPDATE` from
   [runbook 15](../operations/15-progress-comments-enablement-runbook.md), section 4,
   for all repositories, with the cutoff at the cutover time, while writes are
   still off.
2. Roll out the worker and API image through the
   [release procedure](../operations/07-environments-and-release-management.md)
   in the bundled release. No migration.
3. Remove the four keys above from the worker and API env and recreate them.
4. Run one review on the canary and check one comment with the
   `<!-- review-router-live-progress -->` marker that updates in place and ends
   in Complete or Complete with gaps. Then watch `lastErrorCode` and
   `failureCount` on `ReviewProgressPublicationV1` and the worker log line
   `ReviewRouter worker phases failed` for `review_v2.progress_*`.

## Risks

- Every repository now gets a visible bot comment, including third-party
  workspaces. This is the owner's product decision of 2026-11-19.
- Runbook 15 also listed #920 (pagination fence, Draft) as a gate before
  widening beyond the canary. It is not merged; without it a PR with more
  comments than the scan limit can defer instead of creating its comment.
- A failing progress phase makes the worker loop sleep `errorDelayMs` before
  its next pass. It never changes the final review, but repeated failures slow
  the loop; that is the rollback signal.

## Retry and rollback

No data is migrated. Kill switch as above. Rolling back the image restores the
old wording and the old defaults; with the four keys removed the old image
would treat writes as off (its empty allow-list was fail-closed). Published
comments stay on GitHub; an in-flight comment can freeze in a middle phase.

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                                  |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | -------------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Merged, not deployed     | PR       | Ship in the next bundled worker/API rollout. |
