# Dead account exports and one shared provider mapping: deployment

- Task ID: `2026-11-18-remove-dead-account-exports`
- Goal: no user-visible change. Four exports that nothing calls are removed
  and the Providers list and setup dialog build their saved-provider rows with
  one shared server function (`saved-provider-profiles.ts`) instead of two
  copies.
- Affected services/targets: Web only (`apps/web`). No API, worker, database,
  configuration, Gateway or native change.
- Implementation PR/issue:
  [PR #910](https://github.com/777genius/review-router-ai/pull/910); plan
  [83 §7](https://github.com/777genius/review-router-ai/blob/f4bff978b6f72cf94635f29cc6532e3059884f9b/ai-docs/architecture/83-file-size-governance.md).
- Implementation reference: the branch head of that PR.
- Dependencies: none.
- Last updated: `2026-11-18`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker           |
| -------------------- | --------- | ------------------------------- | ------------------- | ---------------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Ship with the next ordinary Web release. |
| production           | `pending` | Not verified                    | Not verified        | Ship with the next ordinary Web release. |

`pending` means no verified completion is recorded. See the
[status contract](README.md#status-contract).

## Applicability and prerequisites

- Refactor only: the removed exports had no callers, and the shared mapping
  returns the same fields as both previous copies.
- `reconcileGatewayAccountFence` is intentionally kept (plan 83 §7): it is the
  only targeted retry for a workspace binding fence stuck in `remote_pending`.

## Ordered rollout

1. Ordinary Web deployment through the
   [release process](../operations/07-environments-and-release-management.md).
2. No migration, configuration or activation step.

## Verification and completion

- The Providers tab lists saved providers with the same logos, owners and
  actions as before, and the provider setup dialog opens for a repository.

## Retry, partial completion, and rollback

Stateless; roll back by deploying the previous Web image.

## Related links

- [Plan 83](https://github.com/777genius/review-router-ai/blob/f4bff978b6f72cf94635f29cc6532e3059884f9b/ai-docs/architecture/83-file-size-governance.md) ([PR #908](https://github.com/777genius/review-router-ai/pull/908)).
- [Release process](../operations/07-environments-and-release-management.md).

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action                |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | -------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Not deployed yet.        | None     | Next ordinary Web release. |
