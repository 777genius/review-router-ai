# Fully covered review stays complete when a quote has no unique span: deployment

- Task ID: `2026-11-20-ocr-unverified-span-advisory`
- Goal: a managed OCR review that covered every file no longer ends red with
  `required_review_coverage_incomplete` only because a finding quoted code
  that matches no unique span in the HEAD file. That finding keeps file-level
  placement without an inline anchor or suggested patch, as before.
- Affected target: the public Action runtime only (`777genius/review-router`,
  `dist/index.js` and `dist/single-t0-plan.js`). Web, API, worker, Gateway,
  native and the database are unchanged.
- Implementation: [review-router#403](https://github.com/777genius/review-router/pull/403).
  Analysis and the other failure classes:
  [plan 86](../architecture/86-review-failure-classes-fixes.md).
- Implementation reference: `39e2870357b5f6787167225d6dea0732888074e7` on the
  public Action `main`.
- Dependencies: none. No migration, configuration or feature flag.
- Last updated: 2026-11-20.

## Environment status

| Target                    | Status      | Actual version                          | Evidence                                                                                 |
| ------------------------- | ----------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| Public Action `main`      | `installed` | `39e28703`                              | review-router#403 merged (squash)                                                        |
| Public Action release/tag | `installed` | `v1.0.243` = `workflow-v1` = `1db48dfa` | [Bundle 3](2026-11-20-bundle3.md); no unverified span in the canary, so not observed yet |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## What changes at runtime

- When the OCR engine finished, every assigned path is covered, no finding was
  skipped, no turn hit the output limit and the only normalization cause is
  `unverified_native_span`, the slot carries `provider_warning` and
  `unverified_native_span` instead of also `context_inspection_incomplete`.
  The projection then reports coverage complete, which matches the SaaS
  `coverageState` that was already `completed` for these runs. The verified
  inline findings and lifecycle changes of such a run are published like on
  any complete review instead of being withheld.
- The cost: the summary no longer explains why that finding has no inline
  anchor, and lifecycle changes now apply on a run with an unverified quote.
  If the model made the quote up, nothing shows it.
- With any other degradation the slot keeps the full flag pair and the summary
  still explains the unverified quote.
- The SaaS T0 reuse guard blocks only OCR observations with
  `context_inspection_incomplete`, so such an observation can now be reused for
  the exact same revision. `unverified_native_span` still ranks it below
  grounded evidence.

## Applicability and rollout

1. The PR was merged straight into the public Action `main` as `39e28703`,
   with the rebuilt bundle; no sync step is needed.
2. Users get it only with the next Action release in the
   [release procedure](../operations/07-environments-and-release-management.md),
   which includes the usual producer registration and Action ref alignment.
   Rides in the next bundled rollout, NOT deployed.

## Verification and completion

After the release, read-only on the RR database: new
`ReviewEvidenceObservation` rows whose `qualityFlagsJson` has
`unverified_native_span` but not `context_inspection_incomplete`, and their
executions end with a complete projection. In the run log the acceptance line
shows `"reasons":["unverified_native_span"]`, `classificationPartial:false`,
`skippedFindingCount:0` and `uncoveredPathCount:0` (an output-limit turn is
not in that line, so the database check is the main one).

## Retry and rollback

The bundle is a build artifact: rebuild with `npm run build` and commit.
Reverting the commit restores the old behaviour after the next sync and Action
release. Observations already stored with only the advisory flags stay
eligible for exact-revision reuse after a rollback.

## Execution log

| Time (UTC)       | Environment                          | Operator | Actual version / image  | Step and observed result                                                   | Evidence                          | Next action                                                            |
| ---------------- | ------------------------------------ | -------- | ----------------------- | -------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------- |
| 2026-11-20 04:40 | public Action `main`                 | N2       | `39e28703`              | #403 merged, not released                                                  | review-router#403                 | Ship with the next bundled rollout and Action.                         |
| 2026-11-20 07:35 | public Action release, `workflow-v1` | D4       | `v1.0.243` = `1db48dfa` | Released, producer 243 registered, `workflow-v1` promoted after the canary | [bundle 3](2026-11-20-bundle3.md) | Watch the next OCR review with an unverified span: it must stay green. |
