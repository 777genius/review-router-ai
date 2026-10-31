# Outbox failure privacy: deployment

- Task ID: `2026-10-31-outbox-error-privacy`.
- Goal: prevent provider credentials and private handler exception text from entering durable outbox failure summaries.
- Affected targets: ordinary worker and Skills scanner worker sharing the outbox handler execution path.
- Implementation: [PR #756](https://github.com/777genius/review-router-ai/pull/756); [plan](../plans/2026-10-31-outbox-error-privacy.md).
- No migrations, secrets, flags or activation changes specific to this task.
- Last updated: `2026-10-31`.

## Environment status

| Environment | Status    | Installed release / image | Actual verification |
| ----------- | --------- | ------------------------- | ------------------- |
| staging     | `pending` | Not verified              | Not executed        |
| production  | `pending` | Not verified              | Not executed        |

`pending` means no verified deployment evidence is recorded, not observed absence.

## Ordered rollout

1. Reconcile the actual installed-to-target release range and pending work under the [release process](../operations/07-environments-and-release-management.md).
2. Verify exact-source unit and persisted retry/dead-letter tests, SQL migration compatibility, architecture, build, self-hosted E2E and mandatory CI with independent security/code review.
3. Deploy a coherent authorized ordinary-worker and Skills scanner-worker build, drain old consumers and preserve in-flight claims and external effect receipts. No replay of uncertain actions.
4. Verify failure detail surfaces show stable codes without raw exception messages and that retryable/non-retryable controls and one-shot failure reporting remain correct.
5. Record the actual image/commit, environment, operator, UTC time and durable verification evidence before marking a target `deployed`.

## Retry / rollback

Use the [ordinary rollback procedure](../operations/07-environments-and-release-management.md#rollback).
Rollback restores the previous raw-message persistence risk; no schema rollback is needed.
Historic stored error text is not erased by this change; separate authorization and
privacy review are required before any retrospective cleanup.

## Execution log

No rollout attempt or environment verification receipt is recorded.
