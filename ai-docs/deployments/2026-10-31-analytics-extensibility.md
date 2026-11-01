# Analytics extensibility — deployment

- Task ID: `2026-10-31-analytics-extensibility`.
- Implementation: [catalog #768](https://github.com/777genius/review-router-ai/pull/768),
  [URL/UI #769](https://github.com/777genius/review-router-ai/pull/769),
  [diagnostics #770](https://github.com/777genius/review-router-ai/pull/770).
- Plan: [analytics-extensibility](../plans/2026-10-31-analytics-extensibility.md).
- Affected targets: Web, compiled Statistics/Usage feature packages and one
  optional read-only operator script.
- Dependencies: none beyond the selected coherent release. No new migration,
  flag, process, external BI service or activation step.

| Environment | Status    | Actual revision | Evidence             |
| ----------- | --------- | --------------- | -------------------- |
| staging     | `pending` | Not verified    | No rollout performed |
| production  | `pending` | Not verified    | No rollout performed |

## Rollout and rollback

1. Reconcile unfinished tasks and exact target release through the
   [release runbook](../operations/07-environments-and-release-management.md).
2. Qualify final CI, target revision and absence of new schema prerequisites.
3. Deploy the coherent Web/feature build through the existing release process.
4. Verify unchanged published review counts, unique PRs, first-seen issues and
   token/cost/attempt values, authorized member/admin isolation, coverage and
   unknown-value UI semantics. Confirm slow-read logs contain no actor, SQL,
   filter or workspace identifiers. Record actual deployed revision/evidence.
5. Roll back the application build if necessary; these metadata-only definitions
   do not create a data migration, replay or independent worker.

**Separate production incident:** PR #760's merged code does not establish
that older Statistics dead-letter events were replayed. Operators must first
verify grants and reconcile those events using existing outbox/release
procedures; do not report historical completeness without proof.

No environment was deployed by this PR.
