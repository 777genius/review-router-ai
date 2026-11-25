# One removal entry per connection row: deployment

- Task ID: `2026-11-18-single-account-stack`
- Goal: in the combined Providers > Connections list of a shared workspace, a
  connection row offers "Remove from this workspace" once, with a confirmation that says
  who can add it back. The rows of the workspace and of other members lose the
  extra "Access" button that opened the same confirmation with personal-account
  copy. Removing an organization connection from the list rereads its row, so
  "Add to this workspace" is offered right after the gateway confirms.
- Affected target: Web only.
- Implementation: [ReviewRouter AI PR #912](https://github.com/777genius/review-router-ai/pull/912). Plan:
  [77](../architecture/77-single-account-stack.md).
- Dependencies: PR #901 (one Connections list), already merged. Ship in the same
  Web release or after it. No migration, configuration, feature flag, Gateway or
  native change.
- Last updated: 2026-11-18.

## Environment status

| Target     | Status      | Actual image                         | Evidence                                                                                                            |
| ---------- | ----------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Staging    | `pending`   | Not verified                         | Ordinary web rollout and the checks below                                                                           |
| Production | `installed` | `7c176ef7`, image `sha256:a2c03f03…` | [rollout 7c176ef7](2026-11-19-rollout-7c176ef7.md) 2026-11-19 15:56 UTC. Dashboard checks need the owner's session. |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## Applicability and rollout

1. Confirm the selected web image contains the merged change, then deploy it
   through the existing web release path in the
   [release procedure](../operations/07-environments-and-release-management.md).
   Ordinary code rollout is sufficient.
2. As an owner or admin of a shared workspace, open the menu of an organization
   connection: one "Remove from this workspace". It asks for confirmation; after
   it the row says "Not added to this workspace" and its menu offers "Add to this
   workspace". Add it back if this was a real connection.
3. As a plain member, rows of other owners show no "Access" button and no menu.
4. Your own rows still have "Access" (or "Add to this workspace"), unchanged.
5. Record the actual image/version, timestamp and evidence separately for each
   environment.

## Rollback

Roll back the web image. No data is written differently: removal uses the same
server actions as before. The fallback list shown without the personal service
keeps its own immediate removal; this change does not touch it.

## Execution log

| Time         | Target             | Actual version | Result                                   |
| ------------ | ------------------ | -------------- | ---------------------------------------- |
| Not executed | Staging/Production | Not verified   | Pending; no environment mutation claimed |
