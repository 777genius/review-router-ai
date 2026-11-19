# Progress comment terminal promotion and retries: deployment

- Task ID: `2026-11-20-progress-terminal-promotion-retry`
- Goal: a live progress comment that a user already sees always reaches its
  final state (Complete, Complete with gaps, Failed, Superseded) after the
  review is published, instead of staying at "Assembling results" when one
  promotion attempt was lost. Short database conflicts no longer fail a
  progress pass, and old failures no longer count against a comment that was
  written or repaired since.
- Affected target: worker only. Web, API, Gateway, native and the public Action
  are unchanged.
- Implementation: the PR that adds this file (fixes from the open CodeRabbit
  threads on [PR #821](https://github.com/777genius/review-router-ai/pull/821)).
- Dependencies: ships in the same bundled worker rollout as
  [progress comments on by default](2026-11-19-progress-comments-default-on.md),
  and must be in the worker image before writes are turned on. No migration,
  no new configuration and no feature flag.
- Last updated: 2026-11-20.

## Environment status

| Target     | Status    | Actual image | Evidence                                                    |
| ---------- | --------- | ------------ | ----------------------------------------------------------- |
| Staging    | `pending` | Not verified | Ordinary worker rollout and the checks below                |
| Production | `pending` | Not verified | Rides in the next bundled worker rollout; not deployed yet. |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).
Merging the PR did not deploy anything.

## What changes at runtime

- Terminal promotion keeps the fast path (settlements seen in the same pass)
  and adds a sweep: each progress pass reads one page of 100 publication scopes
  in key order and promotes the active review of every scope whose posted
  comment still waits at "Assembling results" once its publication attempt has
  durably settled. A lost hint (failed transaction, completion wakeup handled
  by another worker, worker restart, attempt pointer saved late) is therefore
  retried until it succeeds. Promotion stays idempotent: a rerun rereads the
  row and stops once it is terminal.
- The sweep skips scopes without a posted comment. Rows closed by the operator
  backlog expiry in the default-on record have no comment, so the sweep does
  not post terminal comments on old PRs.
- Claim, installation reservation, retry bookkeeping, terminal promotion and
  stale-write repair rerun the whole database step up to 3 times on a
  PostgreSQL serialization failure or deadlock (P2034, 40001, 40P01), with a
  short random pause. GitHub requests are never retried by this.
- A stale-write repair resets `failureCount` and keeps a GitHub `Retry-After`
  deadline instead of becoming due at once. A publication whose only remaining
  work is duplicate cleanup also resets `failureCount`.
- A new installation budget row starts on the database clock.

## Applicability and rollout

1. Confirm the selected worker image contains this change, then roll it out
   through the existing worker path in the
   [release procedure](../operations/07-environments-and-release-management.md),
   together with the default-on rollout and its backlog expiry. Ordinary code
   rollout is sufficient; old and new workers can overlap.
2. On the canary review check that the progress comment ends in its final state
   about 30 s after the App summary.
3. Watch the worker log line `ReviewRouter worker phases failed` for
   `review_v2.progress_promotion`. A repeated failure with
   `review_progress_snapshot_invalid` or an outcome-inconsistency code points
   at a progress row the sweep revisits once per pass over all scopes; it does
   not block the final review.

## Verification and completion

- No progress comment stays at "Assembling results" after its review summary
  is published (`ReviewExecutionProgressV1.phase = 'assembling'` with a
  terminal publication attempt and a posted comment should drain to zero).
- No growth of `review_v2.progress_*` phase failures compared with the canary.

## Retry and rollback

No data is migrated. Rolling back the image restores the hint-only promotion;
progress already promoted stays terminal.

## Related links

- [PR #821 review threads](https://github.com/777genius/review-router-ai/pull/821)
- [Progress comments on by default](2026-11-19-progress-comments-default-on.md)
- [Worker progress comment refactor](2026-11-19-worker-progress-comment-refactor.md)
- [Release process](../operations/07-environments-and-release-management.md)

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                                  |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | -------------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Merged, not deployed     | This PR  | Ship in the next bundled worker/API rollout. |
