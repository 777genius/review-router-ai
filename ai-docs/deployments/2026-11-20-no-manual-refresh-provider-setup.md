# No manual refresh in provider setup: deployment

- Task ID: `2026-11-20-no-manual-refresh-provider-setup`
- Goal: the reviewer roster, the setup dialog and the public model catalogs
  no longer ask the user to click a refresh button in the normal path. Data
  is read again by itself; one status line says "Updating…", "Model list
  updated 3m ago." or gives the failure reason with Try again. The roster's
  "Refresh accounts" button and the setup dialog's "Refresh accounts" block
  are removed.
- Affected services/targets: Web only (`apps/web`). No API, worker, database,
  configuration, Gateway or native change.
- Implementation PR/issue:
  [PR #937](https://github.com/777genius/review-router-ai/pull/937), follow-up
  to [PR #932](https://github.com/777genius/review-router-ai/pull/932).
- Implementation reference: the branch head of that PR.
- Dependencies: PR #932 (merged).
- Last updated: `2026-11-20`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker              |
| -------------------- | --------- | ------------------------------- | ------------------- | ------------------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Rides in the next bundled ordinary Web rollout. |
| production           | `pending` | Not verified                    | Not verified        | Rides in the next bundled ordinary Web rollout. |

`pending` means no verified completion is recorded. See the
[status contract](README.md#status-contract).

## Applicability and prerequisites

- No new requests or timers: the account list and public catalogs already
  reread on open; the only automatic timer is the one from PR #932.

## Ordered rollout

1. Ordinary Web deployment through the
   [release process](../operations/07-environments-and-release-management.md),
   bundled with the next Web rollout.
2. No migration, configuration or activation step.

## Verification and completion

- Providers > Add provider > OpenRouter (GitHub Secrets): the line under the
  model reads "Model list updated …" with a small Refresh, never "Refresh to
  check for updates".
- Workspace reviewers editor: no "Refresh accounts" button below the list.

## Retry, partial completion, and rollback

Stateless; roll back by deploying the previous Web image.

## Related links

- [PR #937](https://github.com/777genius/review-router-ai/pull/937)

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result                       | Evidence | Next action                              |
| ------------ | -------------------- | ---------- | ---------------------- | ---------------------------------------------- | -------- | ---------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed; ships with the next Web release. | None     | Ordinary Web rollout, then verification. |
