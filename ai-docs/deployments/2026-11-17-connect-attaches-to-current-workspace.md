# Connecting from a workspace adds the connection there: deployment

- Task ID: `2026-11-17-connect-attaches-to-current-workspace`
- Goal: a personal connection (Codex, NVIDIA, GLM and others through Account Gateway) made while viewing a shared workspace is added to that workspace right away when its owner is a workspace owner or admin; otherwise it stays personal and the dashboard says why. The accounts UI no longer shows the hidden personal workspace as a separate place.
- Affected target: Web dashboard only.
- Implementation: [ReviewRouter AI PR #886](https://github.com/777genius/review-router-ai/pull/886). Plan: [66](../architecture/66-connect-attaches-to-current-workspace.md).
- Dependencies: ship in the same release as [all providers in all workspaces](2026-11-17-all-providers-in-all-workspaces.md) (step 4). No migration, configuration, feature flag, Gateway or native change.
- Last updated: 2026-11-17.

## Environment status

| Target     | Status      | Actual image   | Evidence                                                                                                                             |
| ---------- | ----------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Staging    | `pending`   | Not verified   | Ordinary web rollout and checks below                                                                                                |
| Production | `installed` | Web `974295ea` | Shipped in the [coordinated rollout](2026-11-17-coordinated-rollout-974295ea.md) together with #887; dashboard steps 2 and 3 not run |

## Applicability and rollout

1. Confirm the selected web image contains the merged change, then deploy it through the existing web release path in the [release procedure](../operations/07-environments-and-release-management.md). Ordinary code rollout is sufficient.
2. As an owner or admin of a shared workspace, open Accounts > Add account, choose "You · personal account" and connect an account. After the connection completes the dialog says "Added to this workspace", the connection appears under "For this workspace" and in Review providers, and a reload shows the same.
3. As a plain member of a shared workspace, connect an account from "All my connections": it connects, the status says only owners and admins can add their own connections, and the workspace list does not show it.
4. Ship together with [all providers in all workspaces](2026-11-17-all-providers-in-all-workspaces.md): it removes the GLM personal-only rule, so a GLM Coding Plan connected from a shared workspace is added like any other plan. Without it, a GLM connect made between the two releases would show "cannot be added" and then be added silently on the next status read.
5. Record the actual image/version, timestamp and evidence separately for each environment.

## Retry and rollback

Each step is a normal dashboard action. The attach reuses the existing owner attach operation with one stable identity per connection and workspace, so repeating a status read never grants access again, including after the access was revoked. Rolling back is an ordinary web image rollback; bindings created by the new flow are ordinary personal attach records and stay revocable through Access. Record any rollback as `rolled_back` with the previous image.

## Execution log

| Time         | Target             | Actual version | Result                                   |
| ------------ | ------------------ | -------------- | ---------------------------------------- |
| Not executed | Staging/Production | Not verified   | Pending; no environment mutation claimed |
