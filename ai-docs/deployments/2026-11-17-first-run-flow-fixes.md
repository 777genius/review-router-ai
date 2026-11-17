# First-run fixes from the get-tok onboarding audit: deployment

- Task ID: `2026-11-17-first-run-flow-fixes`
- Goal: close the Web follow-ups recorded in the [get-tok onboarding audit](2026-11-11-get-tok-onboarding.md#ux-findings-and-follow-up): one model catalog status and refresh button for a Gateway account in the provider dialog, connection links that open Review providers instead of Review settings, and a Usage footer that names the missing measurement.
- Affected target: Web dashboard only. No API, worker, database, Gateway, Action or configuration change.
- Implementation: PR link added on merge. Plan and findings: [74](../architecture/74-first-run-flow-fixes.md).
- Dependencies: none. No migration, activation or feature flag.
- Last updated: 2026-11-17.

## Environment status

| Target     | Status    | Actual image | Evidence                                     |
| ---------- | --------- | ------------ | -------------------------------------------- |
| Staging    | `pending` | Not verified | Ordinary web rollout and checks below        |
| Production | `pending` | Not verified | No deployment authorized by the source merge |

## Applicability and rollout

1. Confirm the selected web image contains the merged change, then deploy it through the existing web release path in the [release procedure](../operations/07-environments-and-release-management.md). Ordinary code rollout is enough.
2. As a workspace owner or admin with a connected Codex Gateway account, open Providers > Review providers > Add provider, pick Codex and the account: the dialog shows one model catalog line and one "Refresh models" button.
3. Open Providers > Connections: "Choose for reviews" on an active connection, and in its Access dialog, opens Review providers for that workspace.
4. Open Usage for a period with Gateway calls: the footer says which measurement was not reported (for Gateway usually "Cost was not reported for some calls; token counts were reported").
5. Record the actual image/version, timestamp and evidence separately for each environment.

## Retry and rollback

Every check is read-only and can be repeated. Rollback is an ordinary web image rollback; no data changes. Record any rollback as `rolled_back` with the previous image.

## Execution log

| Time         | Target             | Actual version | Result                                   |
| ------------ | ------------------ | -------------- | ---------------------------------------- |
| Not executed | Staging/Production | Not verified   | Pending; no environment mutation claimed |
