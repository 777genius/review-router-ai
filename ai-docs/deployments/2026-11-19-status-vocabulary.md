# Plain connection statuses: deployment

- Task ID: `2026-11-19-status-vocabulary`
- Goal: a Connections row whose state could not be established says "Status
  unknown" instead of "Outcome not confirmed yet" when no operation is behind
  it. The fallback Connections list (shown when personal sharing is off or the
  workspace access read fails) uses the main list's status words and its "Used
  in this workspace" / "Not added to this workspace" line instead of raw states
  such as "quarantined" and binding/fence wording; a binding that waits for the
  gateway shows "Confirming change". All lists share one status order
  (`connectionRowStatus`).
- Affected target: Web only.
- Implementation: [ReviewRouter AI PR #915](https://github.com/777genius/review-router-ai/pull/915). Plan:
  [82](../architecture/82-status-vocabulary.md).
- Dependencies: PRs #901 and #912, already merged. No migration,
  configuration, feature flag, Gateway or native change.
- Last updated: 2026-11-19.

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
2. Open Providers > Connections: ready rows still say "Ready", removed and
   changing rows still say "Removing…" / "Confirming change".
3. Where the fallback list is shown (personal sharing off), rows show the same
   status words and no raw state names; removing a connection reports "Removed
   from this workspace." or that the gateway still has to confirm it.
4. Record the actual image/version, timestamp and evidence separately for each
   environment.

## Rollback

Roll back the web image. Only display text and its order change; no data is
written differently.

## Execution log

| Time         | Target             | Actual version | Result                                   |
| ------------ | ------------------ | -------------- | ---------------------------------------- |
| Not executed | Staging/Production | Not verified   | Pending; no environment mutation claimed |
