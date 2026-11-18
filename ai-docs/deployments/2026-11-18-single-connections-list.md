# One Connections list and Codex limits refresh: deployment

- Task ID: `2026-11-18-single-connections-list`
- Goal: Providers > Connections (`/dashboard/setup`) shows one list for the current
  workspace instead of the "For this workspace" and "All <login> connections"
  tabs. Each row says "Used in this workspace" or "Not added to this workspace";
  the viewer's own connections keep Edit, Update key, Reconnect, Disable, Remove,
  Access and limits, and appear once. Codex limits no longer stay silently
  Outdated: the refresh capability check is reused across requests, and a refresh
  that brings nothing newer says so.
- Affected target: Web only.
- Implementation: [ReviewRouter AI PR #901](https://github.com/777genius/review-router-ai/pull/901). Plan:
  [76](../architecture/76-single-connections-list.md).
- Dependencies: none. No migration, configuration, feature flag, Gateway or
  native change.
- Last updated: 2026-11-18.

## Environment status

| Target     | Status    | Actual image | Evidence                                       |
| ---------- | --------- | ------------ | ---------------------------------------------- |
| Staging    | `pending` | Not verified | Ordinary web rollout and the checks below      |
| Production | `pending` | Not verified | Ordinary web rollout with the next Web release |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## Applicability and rollout

1. Confirm the selected web image contains the merged change, then deploy it
   through the existing web release path in the
   [release procedure](../operations/07-environments-and-release-management.md).
   Ordinary code rollout is sufficient.
2. As an owner or admin of a shared workspace, open Providers > Connections: one
   heading, one helper line, no tabs. Your connections show "You" and their state;
   connections of the workspace and of other members follow with their owner.
   "Add account" opens the owner choice; "Add to this workspace" on a row that is
   not added opens Access with this workspace first.
3. As a plain member, the same page shows "Connect account"; your own connection
   that is not added here says only owners and admins can add it.
4. Open a Codex OAuth card whose limits are Outdated (for example Seventeen). It
   either shows fresh numbers after the automatic refresh, a reason such as
   "The provider rejected this account's credentials. Reconnect the account.", or
   "Refresh returned no newer limits. Try again later, or reconnect the account if
   this keeps happening." Record which one, because this tells whether the old
   badge came from code or from the account itself.
5. Record the actual image/version, timestamp and evidence separately for each
   environment.

## Retry and rollback

Each check is a normal dashboard read or action; the attach and revoke reuse the
existing owner operations. The web server changes are a read field (`sourceId`)
on the viewer's own overview rows and an in-memory, per-process reuse of the
Gateway refresh capability answer (10 minutes, rechecked in the background,
failures never kept). Nothing is stored. Rolling back is an ordinary web image
rollback. Record any rollback as `rolled_back` with the previous image.

## Execution log

| Time         | Target             | Actual version | Result                                   |
| ------------ | ------------------ | -------------- | ---------------------------------------- |
| Not executed | Staging/Production | Not verified   | Pending; no environment mutation claimed |
