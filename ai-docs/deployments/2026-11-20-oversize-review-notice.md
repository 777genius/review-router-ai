# Oversized pull request explained on the PR: deployment

- Task ID: `2026-11-20-oversize-review-notice`
- Goal: when hosted admission refuses a review because the pull request is
  over the changed-line ceiling, the pull request gets one short ReviewRouter
  comment with the real numbers and where the limit lives, instead of only a
  red run with `review_run_authorize` 403 and no explanation.
- Affected targets: API only (`apps/api`, hosted review admission gate and a
  new GitHub App comment adapter). Web, worker, Gateway, native and the public
  Action are unchanged; no Action release is needed.
- Implementation: [ReviewRouter AI PR #938](https://github.com/777genius/review-router-ai/pull/938).
- Implementation reference: the squash commit of that PR on `main`; this is not
  proof that it is selected for a release or installed.
- Dependencies: none. No migration and no configuration.
- Last updated: 2026-11-20.

## Environment status

| Target     | Status    | Actual image | Evidence                                                                     |
| ---------- | --------- | ------------ | ---------------------------------------------------------------------------- |
| Staging    | `pending` | Not verified | Ordinary API rollout and the checks below                                    |
| Production | `pending` | Not verified | Not deployed. Rides in the next bundled rollout, not on its own (2026-11-20). |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).
Merging the PR did not deploy anything.

## What changes at runtime

- The admission rule is unchanged: a pull request over
  `REVIEW_ROUTER_HOSTED_MAX_CHANGED_LINES` (production 250000) is still refused
  with 403 and the run is still red.
- After the refusal is decided (or restored on a retry), the API posts or
  rewrites one App comment marked `<!-- reviewrouter:size-limit-notice:v1 -->`
  with the changed lines, the limit, the commit and how to proceed. It runs in
  the background; a GitHub failure only logs `review_size_limit_notice_failed`.
- Evidence of the gap: agent-teams-ai#1192 (1,912,457 changed lines) had
  repeated red runs with `review_run_authorize http_status=403` and no comment.

## Ordered rollout

Ordinary API rollout through the
[release process](../operations/07-environments-and-release-management.md).
No migration, drain or activation step.

## Verification and completion

1. Push to a pull request above the ceiling (or lower the ceiling on staging).
2. The run is still refused, and the pull request shows one size-limit comment
   with the right numbers; a second push rewrites the same comment.
3. API logs show no `review_size_limit_notice_failed` storm.

## Retry, partial completion, and rollback

Rolling back the API stops new notices; existing ones stay and are harmless.

## Related links

- [Release process](../operations/07-environments-and-release-management.md)
- [Quality gates](../operations/03-quality-gates.md)

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                   |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | ----------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed yet.        | None     | Ship in the next bundled one. |
