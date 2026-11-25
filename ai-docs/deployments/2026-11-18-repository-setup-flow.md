# Repository setup states and the first-run guide: deployment

- Task ID: `2026-11-18-repository-setup-flow`
- Goal: the Repositories page counts and filters repositories as Needs
  attention, Setting up, Ready and Not set up (untouched repositories are
  neutral, unselected, archived and GitLab ones leave the counts) and lists the
  ones that need you first. A workspace where nothing is set up yet sees "Get
  your first review": choose a provider, then create a setup PR in a row.
  "Create setup PR" waits with a reason until a provider applies. After a
  Gateway setup PR is merged the row stays on step 2 with one "Verify setup"
  button instead of jumping back to "1 of 4".
- Affected target: Web only.
- Implementation: [ReviewRouter AI PR #913](https://github.com/777genius/review-router-ai/pull/913). Plan:
  [81](../architecture/81-repository-setup-flow.md).
- Dependencies: none. No migration, configuration, feature flag, worker,
  Gateway or native change. The unused `/api/dashboard/repositories/search`
  route is removed; nothing in the product called it.
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
2. Open Repositories in the 777genius workspace: the header shows Ready and
   Not set up (plus Setting up and Need attention only when not zero), the
   repositories that need attention and then those in progress are listed
   first, and old `?setup=needed` links fall back to All.
3. Open Repositories in a workspace with no setup yet (for example one of the
   workspaces that installed the App but never chose a provider): "Get your
   first review" is shown above the list.
4. After the next Gateway setup PR is merged, its row shows "2 of 4 - verify
   setup" with one "Verify setup" button; verifying moves it to Ready.
5. Record the actual image/version, timestamp and evidence separately for each
   environment.

## Retry and rollback

Everything is a read of existing data; the verify button reuses the existing
confirm action. Rolling back is an ordinary web image rollback. Record any
rollback as `rolled_back` with the previous image.

## Execution log

| Time         | Target             | Actual version | Result                                   |
| ------------ | ------------------ | -------------- | ---------------------------------------- |
| Not executed | Staging/Production | Not verified   | Pending; no environment mutation claimed |
