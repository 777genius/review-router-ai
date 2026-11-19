# Account limits show their age instead of Outdated: deployment

- Task ID: `2026-11-19-limits-observation-age`
- Goal: account limits lines no longer turn into a yellow "Outdated" badge
  after five minutes on the page. A window whose observation is five minutes
  old or older shows a quiet "as of 12m ago" (or "as of unknown time") in the
  same spot; a passed reset still says "Reset pending". Details now say that
  Ready describes the connection, not its remaining quota. The five minute
  threshold has one owner in the account limits domain.
- Affected services/targets: Web only (`apps/web`, plus a client-safe
  `@reviewrouter/features-provider-accounts/account-limits` export). No API,
  worker, database, configuration, Gateway or native change.
- Implementation PR/issue:
  [PR #916](https://github.com/777genius/review-router-ai/pull/916); plan
  [78](../architecture/78-automatic-freshness.md).
- Implementation reference: the branch head of that PR.
- Dependencies: none (built on PR #901).
- Last updated: `2026-11-19`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker           |
| -------------------- | --------- | ------------------------------- | ------------------- | ---------------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Ship with the next ordinary Web release. |
| production           | `pending` | Not verified                    | Not verified        | Ship with the next ordinary Web release. |

`pending` means no verified completion is recorded. See the
[status contract](README.md#status-contract).

## Applicability and prerequisites

- Presentation only: no new requests, no polling, no new refresh triggers.
  Refresh buttons and the Codex refresh on open are unchanged.

## Ordered rollout

1. Ordinary Web deployment through the
   [release process](../operations/07-environments-and-release-management.md).
2. No migration, configuration or activation step.

## Verification and completion

- Providers > Connections: a limits line whose observation is older than five
  minutes shows "as of Nm ago" in grey and no "Outdated" badge.

## Retry, partial completion, and rollback

Stateless; roll back by deploying the previous Web image.

## Related links

- [Plan 78](../architecture/78-automatic-freshness.md).
- [Release process](../operations/07-environments-and-release-management.md).

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | -------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed yet.        | None     | Next ordinary Web release. |
