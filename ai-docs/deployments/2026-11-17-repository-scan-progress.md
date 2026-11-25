# Repository scan progress in the dashboard: deployment

- Task ID: `2026-11-17-repository-scan-progress`
- Goal: right after a GitHub App install (or Refresh repos) the Repositories
  list explains that ReviewRouter is scanning GitHub, polls until the scan
  finishes and then shows the repositories without a manual reload. A failed
  or stuck scan shows a clear notice with Retry scan. The setup page re-checks
  the install by itself while it waits for the GitHub webhook.
- Affected services/targets: Web only (`apps/web`, plus a read helper exported
  by `@reviewrouter/features-github-installations` that only the Web image
  uses). No API, worker, database, Gateway or Action change.
- Implementation PR/issue:
  [PR #898](https://github.com/777genius/review-router-ai/pull/898).
- Implementation reference: the branch head of that PR.
- Dependencies: none for the code. Retry only succeeds where the worker can
  write `RepositoryConnection` - see
  [issue #761](https://github.com/777genius/review-router-ai/issues/761).
- Last updated: `2026-11-17`.

## Environment status

| Environment / target | Status      | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker                                                                                                                                             |
| -------------------- | ----------- | ------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| staging              | `pending`   | Not verified                    | Not verified        | Ship with the next ordinary Web release.                                                                                                                                   |
| production           | `installed` | Web `afa74c8f`                  | 2026-11-17 21:22    | Shipped in the [second rollout](2026-11-17-second-rollout-afa74c8f.md); 6 of 9 active installations will show "scan failed" (pre-check 2); a fresh scan was not triggered. |

`pending` means no verified completion is recorded. See the
[status contract](README.md#status-contract).

## Applicability and prerequisites

- Read-only change. The scan state is the newest existing
  `installation.sync_requested` outbox event per active installation; the Web
  role already reads `OutboxEvent`. No migration, index, configuration or
  activation step.
- The new route `GET /api/dashboard/repositories/scan?workspace=<id>` answers
  only viewers with workspace-wide access (same rule as the server render) and
  is polled only while a scan runs: every 3 s at first, backing off to 30 s,
  never on a hidden tab, stopping after 15 minutes of an unfinished scan. While
  the route itself fails, the last read keeps ageing, so the same 15-minute
  ceiling stops polling; read failures are logged as
  `repository_scan_read_failed`.

## Ordered rollout

1. Before the release, read-only check of production (owner/operator): count
   active installations whose newest `installation.sync_requested` event is
   `dead_letter`. Each of those workspaces will show "The last repository scan
   failed" with Retry after the rollout. That is accurate (97 sync events were
   dead-lettered in October, #761), but confirm the worker repository-sync
   grant from `deploy/hetzner/db-grants/` is in place so Retry works.
2. Ordinary code deployment of the Web image through the
   [release process](../operations/07-environments-and-release-management.md).
3. No activation step.

## Verification and completion

- Install the GitHub App on a disposable account (or use Refresh repos on an
  existing workspace): Repositories shows "Scanning repositories" (empty list)
  or a one-line "Scanning ... on GitHub" notice (non-empty list), then the list
  updates by itself within seconds of the scan finishing.
- With a dead-lettered newest sync event: "Repository scan failed" and Retry
  scan; Retry starts a new scan and the notice switches to scanning.
- Browser network panel: `/api/dashboard/repositories/scan` is requested only
  while a scan runs (plus up to one minute after `notice=app_installed`), and
  not while the tab is hidden.
- The setup page "Waiting for GitHub metadata" card redirects to the dashboard
  without pressing Refresh status once the installation webhook is processed.

## Retry, partial completion, and rollback

Stateless Web change: redeploying the previous Web image is a full rollback.
Retry scan uses the existing dashboard sync action (rate limited, deduplicated
per installation and minute).

## Related links

- [Plan 73](../architecture/73-repository-scan-progress.md).
- [Issue #761](https://github.com/777genius/review-router-ai/issues/761).
- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                  |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | ---------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed yet.        | None     | Include in next Web release. |
