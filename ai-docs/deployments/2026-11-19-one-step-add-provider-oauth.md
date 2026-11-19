# Add provider in one step (OAuth providers): deployment

- Task ID: `2026-11-19-one-step-add-provider-oauth`
- Goal: "Add provider" signs in to Codex (device code or browser) and Grok
  (browser and authorization code) inside the same dialog, like the API-key
  providers since stage 1. The old round trip through Connections is removed:
  no "Connect account" link with a return intent, no return banner on
  Connections and no "Continue provider setup" button there.
- Affected target: Web only.
- Implementation: stage 2 of [plan 79](../architecture/79-one-step-add-provider.md).
  The PR link is added when it is opened.
- Dependencies: [stage 1](2026-11-19-one-step-add-provider.md) (PR #917). No
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
   Ordinary code rollout is sufficient. Old links with `keyProvider` to
   Connections only open the page.
2. As an owner or admin, open Providers, choose Add provider and then Codex:
   the dialog shows "Connect Codex" with the device code sign-in. Do not finish
   a real sign-in in production only for this check unless the owner wants it.
3. Record the actual image/version, timestamp and evidence separately for each
   environment.

## Rollback

Roll back the web image. Connections made from the dialog are ordinary
personal connections added to the workspace and keep working.

## Execution log

| Time         | Target             | Actual version | Result                                   |
| ------------ | ------------------ | -------------- | ---------------------------------------- |
| Not executed | Staging/Production | Not verified   | Pending; no environment mutation claimed |
