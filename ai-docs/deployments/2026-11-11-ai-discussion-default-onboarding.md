# AI finding discussion default-on onboarding rollout

- Task ID: `2026-11-11-ai-discussion-default-onboarding`
- Goal: remove the setup checkbox and make newly approved, qualified rotating Codex interaction callers default to safe, author-only suggest replies.
- Implementation: [PR #856](https://github.com/777genius/review-router-ai/pull/856), [reviewed plan](../plans/2026-11-11-ai-discussion-default-onboarding.md).
- Last updated: 2026-11-11.

## Environment status

| Target     | Status    | Actual release/image | Evidence                                          |
| ---------- | --------- | -------------------- | ------------------------------------------------- |
| Staging    | `pending` | Not verified         | Source CI is not a staged deployment              |
| Production | `pending` | Not verified         | No deployment or new setup PR approval authorized |

## Rollout dependencies

1. Use the normal [release procedure](../operations/07-environments-and-release-management.md). The web/API and workflow-source attestation readers must ship together **before** customers create v4 author-gated rotating callers; old v1/v2/v3 exact callers remain admitted. Do not bypass provider runtime pin qualification.
2. Verify the deployed image/version includes both the server default and the v4 canonical verifier changes. No database migration, new feature flag, Action runtime rebuild, provider token, or new GitHub variable is needed.
3. In an existing disposable test repository with a qualified rotating Codex installation, generate and inspect the new setup PR. **Do not auto-merge a customer's setup PR.** After explicit approval, verify the generated interaction YAML includes the author-and-same-repo guard, `REVIEW_ROUTER_DISCUSSION_MODE=off` stops inference, third-party commenter responses do not launch a paid model, and a PR author can obtain a suggest-only answer with a qualified test account.
4. Verify the setup refresh/merge flow and Gateway/Claude/provider-API controls are unaffected. Repeat with a pre-existing v3 caller to confirm compatibility. Record actual Actions run, App-bot author, image, Action SHA and usage in the evidence log; fixture-only tests are not a live model E2E.

## Retry, rollback and scope

If no qualified disposable installation/provider is available, keep live verification `pending`; do not make real provider calls or silently enable unsupported workspaces. No service runs a model merely because setup succeeded; only a qualifying user comment initiates a discussion. To roll back, restore the previous image so newly generated setup PRs use their previous policy, and stop issuing v4 callers; **do not** rewrite already merged customer workflows automatically. Existing repo variable `off` remains a safe opt-out. Record the previous and new image versions before and after deployment.

## Execution log

| Time       | Target         | Actual version  | Outcome                      |
| ---------- | -------------- | --------------- | ---------------------------- |
| 2026-11-11 | Source PR #856 | Git branch only | No staged/production rollout |
