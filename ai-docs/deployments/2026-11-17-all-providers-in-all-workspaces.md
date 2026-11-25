# All providers in all workspaces: deployment

- Task ID: `2026-11-17-all-providers-in-all-workspaces`
- Goal: every provider, including the GLM Coding Plan, can be connected, added and used in any workspace. A personal connection of any plan can be added to a workspace where its owner is an owner or admin, by Access, Add to workspace or connecting from that workspace, and reviews there can use it. Workspace-owned and operator pool connections of any plan bind the same way.
- Affected targets: API (run snapshot capture, review config and conversation binding selection) and Web dashboard.
- Implementation: [ReviewRouter AI PR #887](https://github.com/777genius/review-router-ai/pull/887). Plan: [70](../architecture/70-all-providers-in-all-workspaces.md).
- Dependencies: ship together with [connect attaches to the current workspace](2026-11-17-connect-attaches-to-current-workspace.md) (66). No migration, configuration, feature flag, Gateway or native change.
- Last updated: 2026-11-17.

## Environment status

| Target     | Status      | Actual image       | Evidence                                                                                                                                                |
| ---------- | ----------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staging    | `pending`   | Not verified       | Ordinary API and Web rollout and checks below                                                                                                           |
| Production | `installed` | API/Web `974295ea` | Shipped in the [coordinated rollout](2026-11-17-coordinated-rollout-974295ea.md); attach tests pass on the exact source, dashboard steps 2 to 4 not run |

## Applicability and rollout

1. Confirm the selected API and Web images both contain this change and the 66 change. Deploy them in one release through the [release procedure](../operations/07-environments-and-release-management.md). If they must go separately, deploy API first: Web first only lets a GLM binding be added in a shared workspace that the old API then refuses at run capture.
2. As an owner or admin of a shared workspace, connect a GLM Coding Plan from that workspace: the status says "Added to this workspace", and the connection shows Access like any other plan.
3. As a plain member, connect a GLM plan from a shared workspace: it connects, the status says only owners and admins can add their own connections, and no binding is created.
4. Select the added GLM connection in the shared workspace review config: it is listed and saves. Run a review with it on a disposable repository only if the owner provides a real GLM key for that; otherwise record that run admission was covered by tests only.
5. Record the actual images, timestamp and evidence separately for each environment.

## Retry and rollback

All steps are normal dashboard actions or ordinary reviews and can be repeated. Rolling back API or Web brings back the old rule: GLM bindings in shared workspaces and GLM operator grants stay as records, but the old API refuses to use them. Before a rollback, find review configs in shared workspaces whose provider points at a GLM binding and switch them, or accept that those reviews are refused until the config changes. Such bindings can be removed with Detach in that workspace. Record any rollback as `rolled_back` with the previous images.

## Execution log

| Time         | Target             | Actual version | Result                                   |
| ------------ | ------------------ | -------------- | ---------------------------------------- |
| Not executed | Staging/Production | Not verified   | Pending; no environment mutation claimed |
