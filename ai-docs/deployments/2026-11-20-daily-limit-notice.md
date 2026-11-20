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
- Implementation PR: [#948](https://github.com/777genius/review-router-ai/pull/948).
- Implementation reference: the squash commit of #948 on `main`.
- Dependencies: none to ship. The advice relies on the quota skip
  ([2026-11-17-provider-quota-nonfatal](2026-11-17-provider-quota-nonfatal.md))
  and the ordered fallback (plan 67). Both are installed in production, but
  their live checks are still open
  ([Action 241 record](2026-11-19-action-241-cce9dd98.md)). No migration,
  configuration or feature flag.
- Last updated: 2026-11-20.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker  |
| -------------------- | --------- | ------------------------------- | ------------------- | ------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Ordinary Web rollout            |
| production           | `pending` | Not deployed                    | Not verified        | Rides in bundle 4, NOT deployed |

`pending` means no verified completion is recorded, not that deployment was
observed to be absent. Use the [status contract](README.md#status-contract).

## Ordered rollout

Ordinary Web rollout through the
[release process](../operations/07-environments-and-release-management.md).
No migration, data conversion or activation step applies.

## Verification and completion

Open Providers and choose Review settings on a workspace whose only default
reviewer is an OpenRouter `:free` model: the notice and its Add a second
reviewer button show and Save reviewers stays available; after adding a
reviewer the notice disappears and the keyboard is on the new reviewer's
account. A repository that inherits such a default shows the same notice.

## Retry, partial completion, and rollback

Nothing is stored or migrated; a retry repeats the Web rollout. Rollback is the
previous Web image.

## Related links

- [#948](https://github.com/777genius/review-router-ai/pull/948), plan
  [69](../architecture/69-provider-quota-nonfatal.md) (quota skip) and
  [67](../architecture/67-provider-interaction-mode.md) (fallback in order).
- [OpenRouter limits](https://openrouter.ai/docs/api-reference/limits) for the
  `:free` daily cap.
- [Release process](../operations/07-environments-and-release-management.md).

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result | Evidence | Next action         |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------ | -------- | ------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Merged, not deployed     | None     | Ship with bundle 4. |
