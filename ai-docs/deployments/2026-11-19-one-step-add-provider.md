# Add provider in one step (API-key providers): deployment

- Task ID: `2026-11-19-one-step-add-provider`
- Goal: "Add provider" connects an API-key provider (NVIDIA, OpenRouter, MiMo,
  Kimi, GLM, MiniMax) inside the same dialog. The user picks the provider,
  enters the key, the new connection is added to the current workspace and
  selected, its model is suggested, and "Add and make default" saves it, with
  no trip to Connections and back. OAuth providers (Codex, Grok) keep the
  existing link until stage 2 of the plan.
- Affected target: Web only (UI and its server actions).
- Implementation: [ReviewRouter AI PR #917](https://github.com/777genius/review-router-ai/pull/917),
  stage 1 of [plan 79](../architecture/79-one-step-add-provider.md).
- Dependencies: PRs #901, #912, #913, #915 and #916, already merged. No
  migration, configuration, feature flag, Gateway or native change.
- Last updated: 2026-11-19.

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
   Ordinary code rollout is sufficient; personal connections must stay enabled
   (`REVIEW_ROUTER_PERSONAL_ACCOUNT_SHARING_ENABLED=1`, as today). Without it
   the dialog keeps the old "Connect account" link.
2. As an owner or admin of a workspace without an NVIDIA connection, open
   Providers, choose Add provider and then NVIDIA Build: the dialog shows
   "Connect NVIDIA Build". After a valid key it says "Connected and added to
   this workspace.", the Account is selected and the model list is the
   account's own. Do not save a provider in production only for this check
   unless the owner wants it.
3. As a plain member: the dialog says only owners and admins can do this and
   shows no form.
4. Record the actual image/version, timestamp and evidence separately for each
   environment.

## Rollback

Roll back the web image. Connections made from the dialog are ordinary personal
connections already added to the workspace; they stay and keep working, and the
old dialog lists them under Account. The extra `bindingId` in the attach result
is read only by the new dialog.

## Execution log

| Time         | Target             | Actual version | Result                                   |
| ------------ | ------------------ | -------------- | ---------------------------------------- |
| Not executed | Staging/Production | Not verified   | Pending; no environment mutation claimed |
