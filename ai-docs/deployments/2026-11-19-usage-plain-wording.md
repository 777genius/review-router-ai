# Usage chart wording in plain language: deployment

- Task ID: `2026-11-19-usage-plain-wording`
- Goal: the Usage tooltip, daily table, legend, coverage column, footer note
  and Details text say "today so far", "at least 12,587,499" and "some calls
  did not report all their tokens" instead of "partial day", "(known part)"
  and "some token data incomplete". One formatter owns the wording; no number
  or calculation changes.
- Affected services/targets: Web only (`apps/web`). No API, worker, database,
  configuration, Gateway or native change.
- Implementation PR/issue:
  [PR #930](https://github.com/777genius/review-router-ai/pull/930).
- Implementation reference: the branch head of that PR.
- Dependencies: none.
- Last updated: `2026-11-19`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker           |
| -------------------- | --------- | ------------------------------- | ------------------- | ---------------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Ship with the next ordinary Web release. |
| production           | `pending` | Not verified                    | Not verified        | Ship with the next ordinary Web release. |

`pending` means no verified completion is recorded. See the
[status contract](README.md#status-contract).

## Applicability and prerequisites

- Presentation only: no new requests and no change to usage totals.

## Ordered rollout

1. Ordinary Web deployment through the
   [release process](../operations/07-environments-and-release-management.md).
2. No migration, configuration or activation step.

## Verification and completion

- Dashboard > Usage, last 7 days: hovering today's bar shows
  "YYYY-MM-DD UTC · today so far"; a provider whose calls lack a token total
  reads "at least N"; the coverage column reads "N calls did not report all
  their tokens".

## Retry, partial completion, and rollback

Stateless; roll back by deploying the previous Web image.

## Related links

- [PR #930](https://github.com/777genius/review-router-ai/pull/930)
