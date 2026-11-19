# Account model list keeps itself current: deployment

- Task ID: `2026-11-20-account-model-list-auto-refresh`
- Goal: an NVIDIA account's model list no longer greys out every model once
  its one-minute snapshot lapses. The open picker reads the list again before
  it lapses, an out-of-date or missing list is read again on open, and the
  user sees one status line ("Updating the model list for this account…",
  "Model list updated just now.", or a plain failure reason with Try again)
  instead of a per-option "qualification unavailable". The fail-closed rule
  for stale or cross-vendor snapshots is unchanged.
- Affected services/targets: Web only (`apps/web`). No API, worker, database,
  configuration, Gateway or native change.
- Implementation PR/issue:
  [PR #932](https://github.com/777genius/review-router-ai/pull/932).
- Implementation reference: the branch head of that PR.
- Dependencies: none.
- Last updated: `2026-11-20`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker           |
| -------------------- | --------- | ------------------------------- | ------------------- | ---------------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Ship with the next ordinary Web release. |
| production           | `pending` | Not verified                    | Not verified        | Ship with the next ordinary Web release. |

`pending` means no verified completion is recorded. See the
[status contract](README.md#status-contract).

## Applicability and prerequisites

- Load: the existing non-forced account read, at most once per ~45 seconds
  per NVIDIA binding while a dialog that shows it is open (the reviewer
  roster reads every NVIDIA row it lists; native's snapshot lasts one minute),
  paused in background tabs; a failed read waits 60 seconds. Native keeps
  its own 5-minute cache of the NVIDIA list, so these reads do not reach
  NVIDIA more often than before.
- Proposed separately for the owner, not part of this rollout: native could
  set the catalogue snapshot `ExpiresAt` to 5 minutes (the live list
  freshness) instead of 1 minute.

## Ordered rollout

1. Ordinary Web deployment through the
   [release process](../operations/07-environments-and-release-management.md).
2. No migration, configuration or activation step.

## Verification and completion

- Providers > a provider on an NVIDIA account > Edit: the model is
  selectable without clicking anything, the line under the model reads
  "Model list updated just now.", and it stays selectable after two minutes
  with the dialog open.

## Retry, partial completion, and rollback

Stateless; roll back by deploying the previous Web image.

## Related links

- [PR #932](https://github.com/777genius/review-router-ai/pull/932)

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result                         | Evidence | Next action                              |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------------------------------ | -------- | ---------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Merged only; ships with the next Web release.    | None     | Ordinary Web rollout, then verification. |
