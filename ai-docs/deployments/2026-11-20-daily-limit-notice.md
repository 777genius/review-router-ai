# Daily limit notice for a sole free OpenRouter reviewer: deployment

- Task ID: `2026-11-20-daily-limit-notice`
- Goal: when the reviewer roster (workspace default, a repository, or several
  repositories) has exactly one reviewer and its model is an OpenRouter `:free`
  variant, the editor says once that the model has a daily request limit and
  offers Add a second reviewer. It never blocks saving. Production showed 209
  quota-exhausted slots in 7 days; a sole free reviewer turns every run red
  until the limit resets.
- Affected target: Web only (`gateway-reviewer-roster.tsx` and the shared
  `isOpenRouterFreeVariant` in `@reviewrouter/features-review-providers`, which
  the Web image bundles). API, worker, Gateway, native, the database and the
  public Action are unchanged.
- Implementation: the PR that adds this record.
- Implementation reference: the squash commit of that PR on `main`.
- Dependencies: none. No migration, configuration or feature flag.
- Last updated: 2026-11-20.

## Environment status

| Target     | Status    | Actual image | Evidence                      |
| ---------- | --------- | ------------ | ----------------------------- |
| Staging    | `pending` | Not verified | Ordinary Web rollout          |
| Production | `pending` | Not deployed | Rides in bundle 4, NOT deployed |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## Rollout and verification

Ordinary Web rollout through the
[release process](../operations/07-environments-and-release-management.md).
After it, open Providers, choose Review settings on a workspace whose only
default reviewer is an OpenRouter `:free` model: the notice and its Add a second
reviewer button show; after adding a reviewer they disappear. Rollback is the
previous Web image; nothing is stored.

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action          |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | -------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Merged, not deployed     | None     | Ship with bundle 4.  |
