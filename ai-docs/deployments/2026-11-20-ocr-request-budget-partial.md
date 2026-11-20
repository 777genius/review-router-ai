# A review that reaches its model-request allowance keeps what it finished: deployment

- Task ID: `2026-11-20-ocr-request-budget-partial`
- Goal: a managed OCR review that uses its whole model-request allowance (128
  requests per run on production) publishes the files it already reviewed as a
  partial review instead of discarding everything as
  `gateway_effect_unknown` / 0 of N files. Before, large NVIDIA pull requests
  that ran cleanly for an hour still ended with nothing.
- Affected targets: the public Action runtime (`777genius/review-router`,
  `dist/index.js` and `dist/single-t0-plan.js`) and one line of the RR
  progress comment (worker, `packages/features/review-progress`). Web, API,
  Gateway, native and the database are unchanged.
- Implementation: [review-router#407](https://github.com/777genius/review-router/pull/407). Analysis:
  [plan 87](../architecture/87-nvidia-large-pr-stability.md).
- Implementation reference: `44f9b9ab2bcce84d597d73610efa5d48cfa4d208` on the
  public Action `main`; this is not proof that it is released.
- Dependencies: none. No migration, configuration or feature flag.
- Last updated: 2026-11-20.

## Environment status

| Target                     | Status      | Actual version | Evidence                                                                         |
| -------------------------- | ----------- | -------------- | -------------------------------------------------------------------------------- |
| Public Action `main`       | `installed` | `44f9b9ab`     | review-router#407 merged (squash); CI `build` green on the final head `7a942861` |
| Public Action release/tag  | `pending`   | Not verified   | Next bundled Action release                                                      |
| RR `main` (progress line)  | `pending`   | Not verified   | Merge of review-router-ai#952                                                    |
| RR staging worker image    | `pending`   | Not verified   | Next bundled image                                                               |
| RR production worker image | `pending`   | Not verified   | Next bundled image                                                               |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## What changes at runtime

- When a model-dispatch claim is refused for the request allowance
  (`model_dispatch_budget_exhausted`, local bound or control-plane 409), the
  transport records `{code: model_dispatch_budget_exhausted, effect:
not_dispatched}` instead of an unknown effect. Inference stays fenced exactly
  as before: no further request leaves the runner, later claims get the same
  typed refusal, and nothing is released or retried.
- Model attribution of the requests that completed is kept, so OCR acceptance
  takes the groups OCR finished. The result is always partial
  (`context_inspection_incomplete` + `provider_warning`), the run stays red
  like any incomplete review, and the summary says the review used its whole
  allowance of model requests and covers only part of the changes.
- The same rule now covers the output-limit turn after the third one (#401):
  it still fences inference, but the finished groups are kept as a partial
  review instead of being lost as `actual_model_missing`.
- A later failure with a less certain effect still replaces the stop fact and
  withdraws attribution, as with the output-limit stop of #401. Every other
  unknown or paid effect still fails closed.
- The summary of any partial OCR run no longer counts every file as
  reviewed: files of OCR groups that never finished their main pass are
  listed as `unreviewed` ("the review did not finish this file") and the
  scope line counts only the finished ones (single
  reviewer and roster lanes). A run restored in a new process after
  acceptance still counts the slot's files, as before.
- The RR progress comment no longer prints "Files fully reviewed: X of N"
  when the review ended incomplete with accepted parts; it counts files by
  accepted part and cannot know which part stopped early. The summary keeps
  the real count. A lost review (nothing accepted) still shows "0 of N".
- A response body that names `output_truncated` or
  `model_dispatch_budget_exhausted` is treated as an unknown effect: only a
  stop the runtime observed itself keeps the finished work.
- In reviewer-roster fallback mode, a lane ending with the fenced 4th
  output-limit turn is now a partial accepted lane, so the chain no longer
  hands over to the next reviewer (owner decision G in plan 87).
- Model attribution now survives a known stop for every transport user, Codex
  included. In practice Codex cannot use it: its next turn is refused once
  inference is fenced. Fences are unchanged for all consumers.

## Applicability and rollout

1. Merge the PR into the public Action `main` with the rebuilt bundle, and
   the RR progress-line change into ReviewRouter `main`.
2. The two parts are independent and safe in either order. Users get the
   runtime part only with the next Action release in the
   [release procedure](../operations/07-environments-and-release-management.md)
   (producer registration and Action ref alignment as usual). Rides in the
   next bundled rollout; NOT deployed.

## Verification and completion

After the release, read-only: a run log line `Managed OCR acceptance` with
`acceptedPartial: true`, logged before the closing `Gateway result:
model_dispatch_budget_exhausted; effect: not_dispatched` line; the `finding_discovery` slot is `satisfied` (not
`exhausted`); the summary scope line shows `N/M` with `M > N` and the
request-allowance notice; the progress comment ends "Review incomplete"
without a "Files fully reviewed" line once the RR image is deployed. Such a
run's execution ends `completed` (the slot is `satisfied`, so RR coverage is
`completed`) while the progress terminal is "Review incomplete"; `partial`
still means the old loss. Only large pull
requests reach the allowance, so this may take a while to observe. For the
image part: an incomplete review with accepted parts has no "Files fully
reviewed" line, a lost one still shows "0 of N".

## Retry and rollback

The bundle is a build artifact: rebuild with `npm run build` and commit.
Reverting the commit restores the old behaviour after the next Action release.
The progress line rolls back with the previous RR image. Already published
partial reviews and comments stay as they are.

## Execution log

| Time (UTC)       | Environment                | Operator   | Actual version / image | Step and observed result  | Evidence          | Next action                                |
| ---------------- | -------------------------- | ---------- | ---------------------- | ------------------------- | ----------------- | ------------------------------------------ |
| 2026-11-20 23:07 | public Action `main`       | N          | `44f9b9ab`             | #407 merged, not released | review-router#407 | Ship with the next bundled Action release. |
| Not executed     | public Action release      | Unassigned | Not verified           | Not released.             | None              | Next bundled Action release.               |
| Not executed     | RR `main`                  | Unassigned | Not verified           | Not merged yet.           | None              | Merge review-router-ai#952.                |
| Not executed     | RR staging worker image    | Unassigned | Not verified           | Not deployed.             | None              | Next bundled image.                        |
| Not executed     | RR production worker image | Unassigned | Not verified           | Not deployed.             | None              | Next bundled image.                        |
