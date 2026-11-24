# Usage chart wording in plain language: deployment

- Task ID: `2026-11-19-usage-plain-wording`
- Goal: the Usage tooltip, daily table, legend, KPI, run summary, coverage
  column, footer note and Details text say "so far, until 21:58 UTC",
  "at least 12,587,499" and "some calls may not have reported all their
  tokens" instead of "partial day", "(known part)"/"Known part" and "some
  token data incomplete". One formatter owns the wording; no number or
  calculation changes.
- Affected services/targets: Web only (`apps/web`). No API, worker, database,
  configuration, Gateway or native change.
- Implementation PR/issue:
  [PR #930](https://github.com/777genius/review-router-ai/pull/930).
- Implementation reference: the branch head of that PR.
- Dependencies: none.
- Last updated: `2026-11-19`.

## Environment status

| Environment / target | Status      | Actual deployed version / image      | Last verified (UTC) | Evidence / next step / blocker                                                                                                                                                                                         |
| -------------------- | ----------- | ------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| staging              | `pending`   | Not verified                         | Not verified        | Ship with the next ordinary Web release.                                                                                                                                                                               |
| production           | `installed` | `9ee93eb1`, image `sha256:a032a165…` | 2026-11-20 00:30    | Installed 2026-11-20 00:08 UTC; the served chunks carry "at least " and "so far, until … UTC". The signed-in usage view needs the owner's session; see the [bundled rollout](2026-11-19-progress-comments-enabled.md). |

`pending` means no verified completion is recorded. See the
[status contract](README.md#status-contract).

## Applicability and prerequisites

- Presentation only: no new requests and no change to usage totals.

## Ordered rollout

1. Ordinary Web deployment through the
   [release process](../operations/07-environments-and-release-management.md).
2. No migration, configuration or activation step.

## Verification and completion

- Dashboard > Usage, last 7 days: hovering the last bar shows
  "YYYY-MM-DD UTC · so far, until HH:MM UTC"; a provider whose calls lack a
  token total reads "at least N" and the Known tokens KPI explains it; the
  coverage column reads "N calls may not have reported all their tokens" or
  "N calls did not report a token total".

## Retry, partial completion, and rollback

Stateless; roll back by deploying the previous Web image.

## Related links

- [PR #930](https://github.com/777genius/review-router-ai/pull/930)
