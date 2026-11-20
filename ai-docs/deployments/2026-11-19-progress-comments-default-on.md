# Live progress comment on by default: deployment

- Task ID: `2026-11-19-progress-comments-default-on`
- Goal: every repository gets the live ReviewRouter progress comment on its pull
  requests without any per-repository setup, and the comment reads in plain
  language ("Progress: 3 of 8 parts reviewed (37%)").
- Affected targets: worker (publisher, capture and settings) and API (capture
  and settings). Web, Gateway, native and the public Action are unchanged.
- Implementation: [ReviewRouter AI PR #926](https://github.com/777genius/review-router-ai/pull/926).
- Implementation reference: the squash commit of #926 on `main`; this is not
  proof that it is selected for a release or installed.
- Dependencies: [worker progress comment refactor](2026-11-19-worker-progress-comment-refactor.md)
  (#821, already installed on production). The backlog of old unpublished
  rows must be expired before the worker runs with writes on, see below.
- Last updated: 2026-11-20.

## Environment status

| Target     | Status     | Actual image                         | Evidence                                                                                                                                                                                                                                                            |
| ---------- | ---------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staging    | `pending`  | Not verified                         | Ordinary worker and API rollout and the checks below                                                                                                                                                                                                                |
| Production | `deployed` | `9ee93eb1`, image `sha256:a032a165…` | Swapped 2026-11-20 00:08 UTC with the four progress keys unset on api, worker and scan, after the expiry of 1144 backlog rows. Canary PR 142 and real reviews show one comment edited in place, see the [bundled rollout](2026-11-19-progress-comments-enabled.md). |

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
Capture runs inside the review execution transaction on both the API and the
worker, so `REVIEW_ROUTER_PROGRESS_PROJECTION_CAPTURE` and
`REVIEW_ROUTER_PROGRESS_FILE_COVERAGE` must resolve the same on both roles. A
mismatch (for example `0` or a typo such as `true` on one role only) can make
the next capture of a running review throw `progress_file_coverage_became_invalid`
inside that transaction. Remove or set the keys on both roles together. The
Render deploy script checks this as API/worker drift.

Other environments:

- Render: `render.yaml` and `scripts/deploy-render-hosted-beta.mjs` no longer
  set the keys to `0`, so the next Render deploy gets the default (on) unless the
  operator env sets them.
- Self-hosted: new installs get the default. An existing `.env` that still says
  `0` stays off. A value of `*` from the old instructions is now invalid and
  turns writes off with the warning; remove it to mean every repository.

## Ordered rollout

The order matters. Promotion of finished reviews to a terminal state runs only
in a worker that has writes on, so every review that finishes while writes are
off stays in "Assembling results". The backlog must be expired as close to the
switch as possible. Since [the promotion sweep](2026-11-20-progress-terminal-promotion-retry.md),
expired rows that already had a posted comment are promoted and edited in place
once writes are on; rows without a comment stay closed.

1. Roll out the worker and API image through the
   [release procedure](../operations/07-environments-and-release-management.md)
   in the bundled release, keeping production's explicit
   `REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES=0`. No migration. Writes stay
   off.
2. In one window: stop the worker (or use the moment inside the fleet-overlay
   recreate before the new worker starts), expire the backlog, then start the
   worker with the four keys removed from the worker and API env. Do not leave
   minutes between the expiry and the start.
3. The expiry (operator SQL in the database owner session, as in
   `deploy/hetzner/db-grants/README.md`). It closes every unpublished row whose
   review is no longer planned or running (or no longer exists), with the same effect as the
   publisher's `suppress`, without GitHub calls. Rows of reviews still running
   stay pending and publish normally. A later review on the same PR raises
   `desiredVersion` again. Take the number from the `SELECT` right before the
   block and put it in place of `EXPECTED`:

   ```sql
   SELECT count(*)
     FROM "ReviewProgressPublicationV1" p
    WHERE p."desiredVersion" > p."publishedVersion" AND p."claimId" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "ReviewExecutionV2" e
         WHERE e."executionId" = p."activeExecutionId"
           AND e."state" IN ('planned', 'running'));

   DO $$ DECLARE n int; BEGIN
     UPDATE "ReviewProgressPublicationV1" p
        SET "publishedVersion" = p."desiredVersion",
            "lastErrorCode" = 'review_progress_backlog_expired',
            "updatedAt" = now() AT TIME ZONE 'UTC'
      WHERE p."desiredVersion" > p."publishedVersion" AND p."claimId" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "ReviewExecutionV2" e
           WHERE e."executionId" = p."activeExecutionId"
             AND e."state" IN ('planned', 'running'));
     GET DIAGNOSTICS n = ROW_COUNT;
     IF n <> EXPECTED THEN RAISE EXCEPTION 'expected EXPECTED rows, got %', n; END IF;
   END $$;
   ```

4. Run one review on the canary and check one comment with the
   `<!-- review-router-live-progress -->` marker that updates in place and ends
   in Complete or Complete with gaps. Then watch `lastErrorCode` and
   `failureCount` on `ReviewProgressPublicationV1` and the worker log line
   `ReviewRouter worker phases failed` for `review_v2.progress_*`.

The same rule applies when writes are turned back on after the kill switch:
capture keeps running while writes are off, so repeat step 2 and the expiry.

## Verification and completion

- Exactly one progress comment per PR (marker above), edited in place, phase
  changes visible without the 60 s wait, terminal state about 30 s after the
  App summary.
- No new `review_progress_snapshot_invalid` or
  `review_progress_pagination_inconclusive` in `lastErrorCode`, no growing
  `failureCount`.
- No `Review progress settings are invalid` warning in the worker or API log.
- The time between `ReviewRouter worker processed outbox batch` log lines does
  not grow noticeably (see the loop risk below).
- Record image, operator, time and evidence per environment in the log below.

## Risks

- Every repository now gets a visible bot comment, including third-party
  workspaces. This is the owner's product decision of 2026-11-19.
- Runbook 15 also listed #920 (pagination fence, Draft) as a gate before
  widening beyond the canary. It is not merged; without it a PR with more
  comments than the scan limit can defer instead of creating its comment.
- Progress publication runs in the same worker pass after the final
  publication, up to `REVIEW_ROUTER_PROGRESS_PUBLISH_BATCH_SIZE` (10) rows with
  a few GitHub requests each. It never delays the final review of that pass, but
  the next pass (and the final reviews of other PRs in it) starts only after
  those calls end, and with every repository on the load grows. A failing
  progress phase also makes the loop sleep `errorDelayMs`. Watch the pass
  interval; repeated `review_v2.progress_*` failures are the rollback signal.
  The size of this delay on production is not measured yet.

## Retry and rollback

No data is migrated. Kill switch as above. Rolling back the image restores the
old wording and the old defaults; with the four keys removed the old image
would treat capture and writes as off (its empty allow-list was fail-closed).
Published comments stay on GitHub; an in-flight comment can freeze in a middle
phase.

## Related links

- [PR #926](https://github.com/777genius/review-router-ai/pull/926)
- [Runbook 15](../operations/15-progress-comments-enablement-runbook.md)
- [Live review progress rollout](../../docs/operations/live-review-progress-rollout.md)
- [Worker progress comment refactor](2026-11-19-worker-progress-comment-refactor.md)
- [Release process](../operations/07-environments-and-release-management.md)
- [Quality gates](../operations/03-quality-gates.md)

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                                  |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | -------------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Merged, not deployed     | PR #926  | Ship in the next bundled worker/API rollout. |
