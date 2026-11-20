# Progress comment ends with the summary's coverage verdict: deployment

- Task ID: `2026-11-20-progress-terminal-coverage-truth`
- Goal: when the published review summary says "Review incomplete", the live
  progress comment ends as "Review incomplete" too, instead of "Complete".
  Seen on canary PR 143 revision 2 and on real reviews (review-router-ai run
  44632785589, social-monitor run 44624512923): native spans could not be
  verified, so the Action claimed partial coverage, while every required part
  finished and the server execution completed.
- Affected target: worker (terminal promotion and the comment formatter). The
  API now reads the Action's coverage claim through the same shared predicate;
  its behavior is unchanged. Web, Gateway, native and the public Action are
  unchanged.
- Implementation PR: the PR that adds this file.
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

- One reading of "the published review is complete":
  `projectionClaimsCompleteCoverage` in `packages/features/review-executions`
  reads the Action projection's `coverage.state`, the claim the Action's
  summary renders "Review incomplete" from. The API's coverage exceptions and
  the worker's terminal promotion both use it.
- Terminal promotion reads that claim from the finalized artifact of the same
  generation and head. A completed execution ends as `complete` only when the
  claim is complete, otherwise `complete_with_gaps`; a partial execution stays
  `complete_with_gaps`, and an ordered fallback or quota skip that the Action
  reports complete stays Complete.
- `complete_with_gaps` now shows as "**Phase:** Review incomplete" with the
  line "Some of the review could not be finished or verified. The review
  summary explains why." "Parts that could not be finished" still appears there
  when parts did not finish, and never on Complete.
- The shared count rule `settledOutcomeCountsValid` accepts Review incomplete
  with every required part finished; both outcomes need every required part
  settled.
- The final review publication is unchanged: the server's own coverage verdict
  (`deriveCoverageState`) and everything it drives stay as they were.

## Applicability and rollout

Ordinary worker rollout through the
[release procedure](../operations/07-environments-and-release-management.md).
An older worker treats a Review incomplete snapshot with every part finished as
invalid and suppresses it, so do not run older workers with writes on next to
this one.

## Verification and completion

On the canary, a review whose summary says "Review incomplete" ends with a
"Review incomplete" progress comment, and a complete review ends Complete
without "Parts that could not be finished". Record image and time per
environment below.

## Retry and rollback

No data is migrated. Rolling back the image restores the old mapping and
wording; progress already promoted keeps its stored outcome.

## Related links

- [Progress terminal promotion and retries](2026-11-20-progress-terminal-promotion-retry.md)
- [Complete comment without unfinished parts](2026-11-20-progress-complete-unfinished-line.md)
- [Release process](../operations/07-environments-and-release-management.md)

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                              |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | ---------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed             | This PR  | Ship in the next bundled worker rollout. |
