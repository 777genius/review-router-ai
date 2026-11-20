# Repositories page without a reload after setup confirmations: deployment

- Task ID: `2026-11-20-accounts-line-review-followups`
- Goal: provider confirmations on the Repositories page no longer reload the
  whole document (one server refresh per burst of setup events, instead of one
  per repository row). The provider dialog keeps its steps, "Configure
  connected-account reviewers" and "Reload saved choices" disabled while a
  connect request (for example a Codex device code) is open, and keeps an open
  connect form when a reread of its account list fails. Small wording and
  freshness fixes: one account-list error line with Try again, "Connections"
  instead of "Accounts", a model list age that keeps ticking.
- Affected services/targets: Web only (`apps/web`). No API, worker, database,
  configuration, Gateway, native or public Action change.
- Implementation PR/issue:
  [PR #950](https://github.com/777genius/review-router-ai/pull/950), review
  follow-ups of plans 76-83 (PRs #901 to #937).
- Implementation reference: the branch head of that PR.
- Dependencies: none.
- Last updated: `2026-11-20`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker                  |
| -------------------- | --------- | ------------------------------- | ------------------- | ----------------------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Rides in the next bundled ordinary Web rollout. |
| production           | `pending` | Not verified                    | Not verified        | Rides in the next bundled ordinary Web rollout. |

`pending` means no verified completion is recorded. See the
[status contract](README.md#status-contract).

## Applicability and prerequisites

- No new requests or timers except the one-second age clock of the model list
  status line, which only re-renders that line while it is shown.

## Ordered rollout

1. Ordinary Web deployment through the
   [release process](../operations/07-environments-and-release-management.md),
   bundled with the next Web rollout (no separate small rollout).
2. No migration, configuration or activation step.

## Verification and completion

- Repositories page opened with a workspace id in the URL, then a provider
  confirmed for a repository: the page refreshes its rows in place, expanded
  rows stay open (no full document reload in the browser network log).
- Add provider > Codex (ReviewRouter storage) > Sign in: while the device code
  is shown, "1. Provider" / "2. ..." and "Configure connected-account
  reviewers" are disabled; Cancel sign-in enables them again.

## Retry, partial completion, and rollback

Stateless; roll back by deploying the previous Web image.

## Related links

- [PR #950](https://github.com/777genius/review-router-ai/pull/950)
- [Plan 79](../architecture/79-one-step-add-provider.md),
  [plan 81](../architecture/81-repository-setup-flow.md)

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                          |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | ------------------------------------ |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed yet.        | None     | Include in the next bundled rollout. |
