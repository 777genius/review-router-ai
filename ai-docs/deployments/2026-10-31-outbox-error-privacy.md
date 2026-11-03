# Outbox failure privacy: deployment

- Task ID: `2026-10-31-outbox-error-privacy`.
- Goal: prevent provider credentials and private handler exception text from entering durable outbox failure summaries.
- Affected targets: ordinary worker and Skills scanner worker sharing the outbox handler execution path.
- Implementation: [PR #756](https://github.com/777genius/review-router-ai/pull/756); [plan](../plans/2026-10-31-outbox-error-privacy.md).
- No migrations, secrets, flags or activation changes specific to this task.
- Last updated: `2026-11-03`.

## Environment status

| Environment | Status        | Installed release / image                           | Actual verification                                |
| ----------- | ------------- | --------------------------------------------------- | -------------------------------------------------- |
| staging     | `pending`     | Not verified                                        | Not executed                                       |
| production  | `in_progress` | `6e6a0f078` / official `v1.0.226`, image `0114caaa` | See current R1 evidence and remaining scope below. |

`pending` means no verified deployment evidence is recorded, not observed absence.

## Ordered rollout

1. Reconcile the actual installed-to-target release range and pending work under the [release process](../operations/07-environments-and-release-management.md).
2. Verify exact-source unit and persisted retry/dead-letter tests, SQL migration compatibility, architecture, build, self-hosted E2E and mandatory CI with independent security/code review.
3. Deploy a coherent authorized ordinary-worker and Skills scanner-worker build, drain old consumers and preserve in-flight claims and external effect receipts. No replay of uncertain actions.
4. Verify failure detail surfaces show stable codes without raw exception messages; the post-deploy database privilege probe matches `db_permission_denied` and historical seven-day summaries; retryable/non-retryable controls and one-shot failure reporting remain correct.
5. Record the actual image/commit, environment, operator, UTC time and durable verification evidence before marking a target `deployed`.

## Retry / rollback

Use the [ordinary rollback procedure](../operations/07-environments-and-release-management.md#rollback).
Before rollback, verify that the target build does not persist raw handler messages.
If it does, stop the affected worker consumers or deploy a release retaining the
safe-summary fix before processing resumes; record the exposure and cleanup decision.
No schema rollback is needed. Historic stored error text is not erased by this
change; retrospective cleanup needs separate authorization and privacy review.

## Execution log

No rollout attempt or environment verification receipt is recorded.

## Production R1 /226 — 2026-11-03

The [shared R1 release and environment evidence](evidence/2026-11-03-memory-production-r1-226.json) records official application source `6e6a0f078`, image
`0114caaa…`, all four running roles with zero restarts, and verified 226 producer/channel adoption.

Both ordinary and Skills worker code is installed. The fresh signed repository sync completed once without a permission dead letter; this is not a fabricated failure-path privacy test or retrospective raw-error cleanup. Keep unobserved sanitized error slices pending without replaying old events.

Staging remains unchanged and unverified by this production batch.
