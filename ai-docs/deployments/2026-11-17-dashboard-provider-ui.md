# Dashboard Providers tab fixes: deployment

- Task ID: `2026-11-17-dashboard-provider-ui`
- Goal: on the Providers tab, Gateway rows on the qualified NVIDIA profile show the NVIDIA mark, the reviewer being edited in the roster dialog is highlighted, and the Providers list is current as soon as a default change or removal closes its dialog.
- Affected target: Web dashboard only (new read route `GET /api/dashboard/provider-list`).
- Implementation: branch `fix/dashboard-provider-ui-20261117` in `777genius/review-router-ai` (Draft PR).
- Dependencies: none. No migration, configuration, activation or Action/runtime change.
- Last updated: 2026-11-17.

## Environment status

| Target     | Status    | Actual image | Evidence                                     |
| ---------- | --------- | ------------ | -------------------------------------------- |
| Staging    | `pending` | Not verified | Ordinary web rollout and checks below        |
| Production | `pending` | Not verified | No deployment authorized by the source merge |

## Applicability and rollout

1. Confirm the selected web image contains the merged change, then deploy it through the existing web release path in the [release procedure](../operations/07-environments-and-release-management.md). Ordinary code rollout is sufficient.
2. As a workspace owner or admin on a workspace with at least two connected Gateway accounts, open Providers > Review providers:
   - A row whose Gateway account is on `nvidia-build-chat-apikey-v1` shows the NVIDIA mark, including a personal account shared with the workspace.
   - In "Workspace default provider", the reviewer opened with Edit is highlighted.
   - Make a second account a default reviewer, then use "Remove as default": the Default badges change as soon as each dialog closes, without a page reload, and a reload shows the same state.
3. Record the actual image/version, timestamp and evidence separately for each environment.

## Retry and rollback

Each step is read-only or a normal dashboard write and can be repeated. Rolling back is an ordinary web image rollback; no data is migrated. If the list route misbehaves, the server-rendered list still renders; record any rollback as `rolled_back` with the previous image.

## Execution log

| Time         | Target             | Actual version | Result                                   |
| ------------ | ------------------ | -------------- | ---------------------------------------- |
| Not executed | Staging/Production | Not verified   | Pending; no environment mutation claimed |
