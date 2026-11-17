# Usage names the Gateway vendor, unknown completeness and subscription label: deployment

- Task ID: `2026-11-17-usage-gateway-vendor`
- Goal: Gateway usage is attributed to the real provider (GLM, MiniMax, Kimi,
  Grok, Claude, MiMo) instead of `unknown`, including older rows; calls without
  any token counter show as "without token counts" instead of "marked partial";
  Gateway subscription and coding-plan usage reads "Included in subscription".
- Affected services/targets: ReviewRouter API and Web (vendored Gateway SDK,
  usage attribution and Usage page), then the Account Gateway service. No
  database migration, no native change.
- Implementation PR/issue:
  [account-gateway#113](https://github.com/agent-teams-ai/account-gateway/pull/113)
  (merged first) and [PR #896](https://github.com/777genius/review-router-ai/pull/896); design in
  [audit 72, section 6](../architecture/72-usage-statistics-audit.md).
- Implementation reference: the merged Gateway commit in
  `vendor/account-gateway/nvidia-sandbox-sdk-provenance.json` and the
  ReviewRouter branch head of that PR.
- Dependencies: ships in a **second, small release**, after the production
  deploy that was in progress on 2026-11-17. Builds on
  [usage statistics audit](2026-11-17-usage-statistics-audit.md).
- Last updated: `2026-11-17`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker                          |
| -------------------- | --------- | ------------------------------- | ------------------- | ------------------------------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Second small release: RR first, then Gateway.           |
| production           | `pending` | Not verified                    | Not verified        | After the in-progress deploy; conversation requalified. |

`pending` means no verified completion is recorded. See the
[status contract](README.md#status-contract).

## Applicability and prerequisites

- The SDK archive changed, so `conversation-source-stamp` and the conversation
  verifier changed with it: reissue full-thread conversation qualification
  (`REVIEW_ROUTER_CONVERSATION_QUALIFICATION`) for this ReviewRouter version
  before or with the deploy, as for PR #879/#889. Until then Gateway
  full-thread conversations stay off.
- No migration, redrive or backfill: older rows are relabelled at read time
  from the frozen authorization snapshot; stored facts are unchanged.

## Ordered rollout

Merge order was Gateway, then ReviewRouter (the archive is packed from merged
Gateway main). **Deploy order is the reverse for the wire change:**

1. ReviewRouter API and Web with the new SDK, through the
   [release process](../operations/07-environments-and-release-management.md).
   The new SDK accepts `unknown`, `partial` and `complete` and talks to the
   current Gateway unchanged (vendor lookup is static, no wire change).
2. Account Gateway service from agent-teams-ai/account-gateway main at or after
   #113. From then on it stores `unknown` for counter-less calls.

If the Gateway goes first, the old ReviewRouter SDK rejects any usage page with
`unknown`: Usage reconciliation pauses (cursor does not advance, nothing is
lost) until step 1 lands. Do not leave that gap open for days: the Gateway
replay window for attributed observations is 30 days.

## Verification and completion

- Usage page, Models and Runs: a GLM/MiniMax/Kimi/Grok/Claude/MiMo Gateway
  call shows its vendor, not `unknown`; the Provider filter lists the vendor.
- Older `unknown`/`codex` Gateway rows whose authorization snapshot names a
  qualified profile show the vendor too; the stored `UsageCall.provider` is
  unchanged.
- Gateway rows on subscription, coding plan or M plan profiles with no cost
  read "Included in subscription"; direct-route rows do not.
- After the Gateway step, a new counter-less call shows "without token counts"
  and Details no longer counts it as "marked partial".
- Failure signals: Usage reconciliation errors after the Gateway step (old SDK
  still running), `usage_scope_mismatch` spikes for runner reports.

## Retry, partial completion, and rollback

- ReviewRouter rollback (previous image) restores the old labels; reading back
  `unknown` observations then fails until the Gateway is rolled back too, so
  roll back the Gateway first if both must go.
- Runner reports of v3 Gateway runs in flight during the ReviewRouter step on
  the relabelled profiles can get `usage_scope_mismatch`; their native Gateway
  usage is unaffected. v4 runs compare with the server-written identity.

## Related links

- [Audit 72](../architecture/72-usage-statistics-audit.md).
- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                     |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | ------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed yet.        | None     | Second small release, RR first. |
