# Repositories page without a reload after setup confirmations: deployment

- Task ID: `2026-11-20-accounts-line-review-followups`
- Goal: setup events sent together on the Repositories page ask the server
  for one refresh instead of one per repository row, so the Next router no
  longer falls back to a full document reload after the search rewrote the
  URL. Today the product sends one confirmation per action, so this removes a
  latent hazard (and duplicate server renders) rather than a reload users saw;
  the e2e burst is what hit it. User-visible: the provider dialog keeps its
  steps, "Configure connected-account reviewers" and "Reload saved choices"
  disabled while a connect request (for example a Codex device code) is open,
  and keeps an open connect form with a typed key when a reread of its account
  list fails. Small wording and freshness fixes: one account-list error line
  with Try again, "Connections" instead of "Accounts", a model list age that
  keeps ticking.
- Affected services/targets: Web only (`apps/web`). No API, worker, database,
  configuration, Gateway, native or public Action change.
- Implementation PR/issue:
  [PR #950](https://github.com/777genius/review-router-ai/pull/950), review
  follow-ups of plans 76-83 (PRs #901 to #937).
- Implementation reference: the branch head of that PR.
- Dependencies: none.
- Last updated: `2026-11-21`.

## Environment status

| Environment / target | Status      | Actual deployed version / image      | Last verified (UTC) | Evidence / next step / blocker                                                 |
| -------------------- | ----------- | ------------------------------------ | ------------------- | ------------------------------------------------------------------------------ |
| staging              | `pending`   | Not verified                         | Not verified        | Rides in the next bundled ordinary Web rollout.                                |
| production           | `installed` | `a02b1607`, image `sha256:8d9dd8f3…` | 2026-11-21 12:28    | [Bundle 5](2026-11-21-bundle5.md); the signed-in dialog check needs the owner. |

`pending` means no verified completion is recorded. See the
[status contract](README.md#status-contract).

## Applicability and prerequisites

- No new requests. One new timer: the model list status components use the
  one-second age clock of the limits line, which re-renders only those small
  components while they are mounted.

## Ordered rollout

1. Ordinary Web deployment through the
   [release process](../operations/07-environments-and-release-management.md),
   bundled with the next Web rollout (no separate small rollout).
2. No migration, configuration or activation step.

## Verification and completion

- The refresh coalescing cannot be told apart in normal production use (one
  confirmation per action never reloaded); it is covered by the e2e spec
  `review runtime readiness`, which fails on the old code and passes on this
  one.
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

| Time (UTC)       | Environment | Operator   | Actual version / image               | Step and observed result                                                                  | Evidence                          | Next action                                                           |
| ---------------- | ----------- | ---------- | ------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------- |
| Not executed     | staging     | Unassigned | Not verified                         | Not deployed yet.                                                                         | None                              | Include in the next bundled rollout.                                  |
| 2026-11-21 12:28 | production  | D5         | `a02b1607`, image `sha256:8d9dd8f3…` | Web swapped in bundle 5; `/ready` and Web 200; the UI e2e job had passed on the #950 head | [Bundle 5](2026-11-21-bundle5.md) | Owner: run the signed-in Codex sign-in lock check in the provider dialog. |
