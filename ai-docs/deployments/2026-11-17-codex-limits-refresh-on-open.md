# Codex limits refresh on open: deployment

- Task ID: `2026-11-17-codex-limits-refresh-on-open`
- Goal: opening Accounts or Providers > Connections shows current Codex OAuth
  limits. A card whose saved Codex limits are missing or Outdated refreshes them
  once through the existing quota-only refresh, so `Outdated` and `Reset pending`
  stay rare and truthful instead of being the normal state for idle accounts.
- Affected services/targets: Web only.
- Implementation PR/issue: Draft PR from branch
  `fix/account-limits-freshness-20261117`.
- Implementation reference: branch `fix/account-limits-freshness-20261117`; the
  merge commit is the source provenance once merged.
- Dependencies: [Codex quota refresh batch](2026-11-04-codex-limits-refresh.md)
  (native #93/Gateway #100 quota-only refresh, production `deployed`). No native,
  Gateway, schema or Action change.
- Last updated: `2026-11-17`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker                              |
| -------------------- | --------- | ------------------------------- | ------------------- | ----------------------------------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Ship with the next coherent Web release, then verify below. |
| production           | `pending` | Not verified                    | Not verified        | Ship with the next coherent Web release, then verify below. |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## Applicability and prerequisites

- Ordinary Web code rollout. No migration, configuration, feature flag,
  activation step or public Action release.
- The installed Gateway must keep advertising `account-limits-refresh/v1` with
  `quotaOnlyRefresh=true` for `openai-codex-oauth-responses-v1`. Without it the
  cards stay cached-only, exactly as before this change.

## Ordered rollout

1. Before new code starts: nothing to fence, drain or migrate.
2. Deploy the Web role as part of the next coherent application release.
3. No activation or cutover.
4. Verify the result below before widening the rollout.

## Verification and completion

- Open Providers > Connections with an idle Codex OAuth account whose saved
  limits are older than five minutes. Each such card issues one quota-only
  refresh (no model call, no new Usage record) and then shows windows without
  `Outdated`.
- Kimi, GLM, MiniMax and Grok cards issue no refresh; their native background
  collector keeps them current.
- After a failed refresh, the card keeps the saved limits with the safe
  diagnosis, and reopening it in the same tab within five minutes does not
  refresh again.
- Failure signals: a refresh on every page open for the same account, a refresh
  diagnosis on every open (inspect that account's credentials or provider
  limits), or Gateway `admission_limited` on bounded read routes.

## Retry, partial completion, and rollback

Web-only and idempotent. Roll back to the previous Web image; the refresh only
writes the native display snapshot, so nothing needs cleanup.

## Related links

- [Native limits plan, interactive read rules](../architecture/60-account-native-limits-implementation-plan.md)
- [Codex quota refresh batch](2026-11-04-codex-limits-refresh.md)
- [Release process](../operations/07-environments-and-release-management.md)
- [Quality gates](../operations/03-quality-gates.md)

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                      |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | -------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed yet.        | None     | Include in the next Web release. |
