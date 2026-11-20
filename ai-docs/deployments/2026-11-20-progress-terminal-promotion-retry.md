# Progress comment terminal promotion and retries: deployment

- Task ID: `2026-11-20-progress-terminal-promotion-retry`
- Goal: a posted progress comment of a completed or partial review moves from
  "Assembling results" to its final state after the review is published, also
  when the first promotion attempt was lost, and an ordered-fallback review
  shows Complete instead of staying at "Assembling results". Short database
  conflicts no longer fail a progress pass, and old failures no longer count
  against a comment that was written or repaired since.
- Affected target: worker. The shared "Complete" rule moves into
  `packages/features/review-progress`; the API's capture never produces
  Complete, so the API behaves the same. Web, Gateway, native and the public
  Action are unchanged.
- Implementation PR: [PR #934](https://github.com/777genius/review-router-ai/pull/934),
  fixes from the open CodeRabbit threads on
  [PR #821](https://github.com/777genius/review-router-ai/pull/821).
- Implementation reference: the squash commit of PR #934 on `main`.
- Dependencies: ships in the same bundled worker rollout as
  [progress comments on by default](2026-11-19-progress-comments-default-on.md),
  and must be in the worker image before writes are turned on. No migration,
  no new configuration and no feature flag.
- Last updated: 2026-11-20.

## Environment status

| Target     | Status     | Actual image                         | Evidence                                                                                                                                                                               |
| ---------- | ---------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staging    | `pending`  | Not verified                         | Ordinary worker rollout and the checks below                                                                                                                                           |
| Production | `deployed` | `9ee93eb1`, image `sha256:a032a165…` | Installed 2026-11-20 00:08 UTC; terminal states reached Complete on canary PR 142 and on social-monitor #782/#764, see the [bundled rollout](2026-11-19-progress-comments-enabled.md). |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).
Merging the PR did not deploy anything.

## What changes at runtime

- Terminal promotion keeps the fast path (settlements seen in the same pass)
  and adds a sweep: each progress pass reads one page of 100 publication scopes
  in key order and promotes the active review of every scope whose posted
  comment still waits at "assembling" once its publication attempt has durably
  settled. A lost hint (failed transaction, completion wakeup handled by another
  worker, worker restart, attempt pointer saved late) is retried on the next
  pass over all scopes. One pass takes (number of publication rows / 100)
  worker passes, so this recovery delay grows with history; the fast path still
  covers the normal case. Promotion stays idempotent: a rerun rereads the row
  and stops once it is terminal.
- A swept candidate that cannot be promoted is logged as
  `Review progress sweep could not promote a review` (execution ID and safe
  error code, once per execution and worker process) and does not fail the
  phase, so one bad row cannot keep the worker loop on `errorDelayMs`. Failures of this pass's own settlements still
  fail `review_v2.progress_promotion` as before.
- "Complete" now accepts every required part settled with at least one
  finished, matching the execution's coverage verdict: an ordered fallback
  (plan 67) completes with later reviewers' parts cancelled or a failed
  earlier reviewer's parts exhausted. Before, such a review threw
  `review_progress_complete_outcome_inconsistent` and its comment stayed at
  "Assembling results". The Complete comment counts only the parts that
  covered the review ("Progress: 2 of 2 parts reviewed (100%)"), adds "Parts
  not needed: N" for the cancelled ones and keeps "Parts that could not be
  finished" for a failed reviewer.
- The sweep skips scopes without a posted comment, so rows closed by the
  backlog expiry that never had a comment get no new comment. Expired rows
  that do have a comment (the canary repository, or PRs commented before a
  kill switch) are promoted and edited in place on open PRs with the same head;
  on a closed PR or a moved head the publisher suppresses without writing.
- Claim, installation reservation, retry bookkeeping, terminal promotion and
  stale-write repair rerun the whole database step up to 3 times on a
  PostgreSQL serialization failure or deadlock (P2034, 40001, 40P01), with a
  short random pause. GitHub requests are never retried by this.
- A stale-write repair resets `failureCount` and is due at GitHub's
  `Retry-After` deadline when there is one, otherwise at once. A publication
  whose only remaining work is duplicate cleanup also resets `failureCount`.
- A new installation budget row starts on the database clock.

## Applicability and rollout

1. Confirm the selected worker image contains this change, then roll it out
   through the existing worker path in the
   [release procedure](../operations/07-environments-and-release-management.md),
   together with the default-on rollout and its backlog expiry. Ordinary code
   rollout is sufficient; old and new workers can overlap while writes are
   off, as they are during the default-on rollout step.
2. On the canary review check that the progress comment ends in its final state
   about 30 s after the App summary.
3. Watch the worker log for `ReviewRouter worker phases failed` with
   `review_v2.progress_promotion` and for
   `Review progress sweep could not promote a review`. A sweep warning names
   a progress row that cannot become terminal (logged once per worker process); it does not fail the phase or delay the final review.

## Verification and completion

- Posted comments stop accumulating at "Assembling results": rows with
  `ReviewExecutionProgressV1.phase = 'assembling'`, a terminal publication
  attempt and a posted comment drain within one sweep pass, except executions
  named by sweep warnings.
- No growth of `review_v2.progress_*` phase failures compared with the canary.

## Retry and rollback

No data is migrated. Rolling back the image restores the hint-only promotion
and the strict "Complete" counts; progress already promoted stays terminal.
An older worker image treats a Complete snapshot of an ordered fallback as
invalid and suppresses it, and that comment then stays at "Assembling results".
So do not run older workers with writes on next to this one, and prefer the
kill switch over an image rollback while writes are on.

## Related links

- [PR #934](https://github.com/777genius/review-router-ai/pull/934)
- [PR #821 review threads](https://github.com/777genius/review-router-ai/pull/821)
- [Progress comments on by default](2026-11-19-progress-comments-default-on.md)
- [Worker progress comment refactor](2026-11-19-worker-progress-comment-refactor.md)
- [Release process](../operations/07-environments-and-release-management.md)

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                                  |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | -------------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed             | PR #934  | Ship in the next bundled worker/API rollout. |
