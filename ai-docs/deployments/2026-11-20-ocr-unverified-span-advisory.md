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
- Dependencies: none. No migration, configuration or feature flag.
- Last updated: 2026-11-20.

## Environment status

| Target                    | Status    | Actual version | Evidence                                   |
| ------------------------- | --------- | -------------- | ------------------------------------------ |
| Public Action `main`      | `pending` | Not merged yet | review-router#403                          |
| Public Action release/tag | `pending` | Not released   | Rides in the next bundled rollout (Action) |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## What changes at runtime

- When the OCR engine finished, every assigned path is covered, no finding was
  skipped, no turn hit the output limit and the only normalization cause is
  `unverified_native_span`, the slot carries `provider_warning` and
  `unverified_native_span` instead of also `context_inspection_incomplete`.
  The projection then reports coverage complete, which matches the SaaS
  `coverageState` that was already `completed` for these runs.
- With any other degradation the slot keeps the full flag pair and the summary
  still explains the unverified quote.
- The SaaS T0 reuse guard blocks only OCR observations with
  `context_inspection_incomplete`, so such an observation can now be reused for
  the exact same revision. `unverified_native_span` still ranks it below
  grounded evidence.

## Rollout

Rides in the next bundled rollout with the next public Action release. NOT
deployed. No server-side step.

## Verification and completion

After the Action release, the first OCR run whose acceptance log shows
`"reasons":["unverified_native_span"]` with no other reason ends green, its
summary has no "Review incomplete" and the finding is listed at file level.
Read-only check: new executions with the `unverified_native_span` flag whose
`qualityFlagsJson` has no `context_inspection_incomplete`.
