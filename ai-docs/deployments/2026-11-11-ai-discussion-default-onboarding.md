# AI finding discussion default-on onboarding rollout

<a id="current-production-reconciliation-2026-11-14"></a>

## Current production reconciliation (2026-11-15)

Confirmed current application delivery is signed private **238**, source `75b3a479f8f1febf5920d566d10d1a7db641faeb`, OCI index/actual Docker LocalId `sha256:add1ae123acec36032e873124370e66e5b2b1e220f05b3ff1f69988e4df1a434`, paired with public **Action 238** at `42b37d742fca5c4a40b540db437a6400e5ea5f2a` and Gateway **108/native 98**. Four FILE 66 roles are healthy with zero restarts; normal producer registration preserved old 237 and existing profiles. The combined activation restored admission at `2026-11-15T00:50:19Z`; app schema 166 and native ledger 318 are unchanged, with no migration. The [current registry baseline](README.md#current-coordinated-rollout-reconciliation-2026-11-14) records actual activation and channel evidence. Earlier 234/235/236/237 results below remain historical, not relabeled 238 qualification.

#856 code and v4 source readers are installed. No newly generated/approved v4 author-only interaction caller or live subscription discussion is qualified by this record. Existing customer callers/defaults are not automatically rewritten. Qualification still needs its own scoped setup approval, author/non-author/off guards and real App readback; do not redeploy the installed code for that gap.

- Task ID: `2026-11-11-ai-discussion-default-onboarding`
- Goal: remove the setup checkbox and make newly approved, qualified rotating Codex interaction callers default to safe, author-only suggest replies.
- Implementation: [PR #856](https://github.com/777genius/review-router-ai/pull/856), [reviewed plan](../plans/2026-11-11-ai-discussion-default-onboarding.md).
- Last updated: 2026-11-15.

## Environment status

| Target     | Status      | Actual release/image  | Evidence                                                       |
| ---------- | ----------- | --------------------- | -------------------------------------------------------------- |
| Staging    | `pending`   | Not verified          | Source CI is not a staged deployment                           |
| Production | `installed` | Signed 238/source 75b | v4 caller activation and live author-only reply remain pending |

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
