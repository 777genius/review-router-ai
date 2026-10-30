# Usage SQL read path: deployment

- Task ID: `2026-10-30-usage-sql-read-path`.
- Goal: calculate tenant and operator Usage reports in PostgreSQL while returning
  only aggregate results, summary-family metadata and the requested observation
  page to the application, with unchanged accounting and authorization.
- Affected targets: Web and compiled consumers of the provider-usage feature.
- Implementation: [PR #746](https://github.com/777genius/review-router-ai/pull/746).
- Plan published before implementation as `3b481b00da4104533764c2e033a9925c8b0c82b0`.
- Dependencies: existing Usage schema, migration
  `000155_usage_member_report_index`, and the selected release's ordinary fleet
  prerequisites. No new service, environment configuration, feature flag, ledger
  rewrite or activation step is introduced by this task.
- Last updated: `2026-10-30`.

## Environment status

| Environment | Status    | Actual version / image | Evidence / next step                                                            |
| ----------- | --------- | ---------------------- | ------------------------------------------------------------------------------- |
| staging     | `pending` | Not verified           | Qualify and select a coherent release, then perform the authorized rollout.     |
| production  | `pending` | Not verified           | Reconcile the installed version and follow the release process when authorized. |

Local tests, PR checks and merge do not establish deployment. No rollout has
been attempted as part of this implementation task.

## Ordered rollout

1. Read the [release process](../operations/07-environments-and-release-management.md)
   and reconcile all unfinished tasks applicable to the exact shipping version.
   Verify that the final PR head passed its required checks and that the release
   contains the reviewed implementation and any qualified schema prerequisite.
2. Apply `000155_usage_member_report_index` through the existing pinned migration
   path before the application rollout. Its single `CREATE INDEX CONCURRENTLY`
   statement must run outside an explicit transaction; do not reuse a historical
   transaction-wrapped additive migration window. Confirm the index
   `UsageCall_workspaceId_actorId_occurredAt_idx` is valid and indexes exactly
   `("workspaceId", "actorId", "occurredAt")` on `"UsageCall"`. Concurrent build
   avoids the ordinary index build's write-blocking lock, but consumes I/O/CPU;
   use the selected release's normal operational window and monitoring.
   The checkout/rollout catalog admits this exact checksum-bound tail while
   preserving the managed 92 and historical 96 inventories. It is excluded from
   historical repair SQL and from the transaction-wrapped additive window.
3. Deploy the Web build and affected compiled feature consumers coherently.
   Existing ledger records are read directly; there is no backfill or new flag.
4. Verify authenticated tenant-admin, member and operator report journeys using
   authorized test accounts. Record the deployed commit/image and durable
   environment evidence before marking this task complete.

## Verification

- Full-period token/cost totals, requested-model/provider filters and facets are
  unchanged when observation or run pagination advances independently.
- Member reports remain actor-scoped; foreign workspace and revoked operator
  access remain denied. Partial-family reports do not double-count summaries
  and their children, including a correction concurrent with the report.
- The existing Usage screen loads, filters and expands runs at desktop/mobile
  widths without new technical details or changed user actions.
- Observe report latency, query timeouts and database CPU/temp I/O using the
  deployment's existing monitoring. Local synthetic workload timings establish
  a bounded qualification result, not production capacity or an uptime promise.

The observation hydration is page-bounded. Family metadata, aggregate/facet
cardinality and grant coverage still grow with their actual data; exact totals
still scan authorized facts in PostgreSQL. Preserve these limits in operational
capacity decisions.

## Retry and rollback

Inspect the failed step and actual installed version before retrying. Roll back
the coherent application build through the release source of truth. Retain the
additive valid index during application rollback; the older reader remains
compatible. This task does not delete or rewrite usage facts and needs no ledger
data rollback.

An interrupted concurrent build can leave an invalid index and a failed migration
record. Inspect the exact index definition, validity and migration state first.
Only after confirming the invalid object belongs to this task, remove that
invalid index with `DROP INDEX CONCURRENTLY` outside a transaction, mark this exact
failed migration rolled back through the existing Prisma recovery procedure,
and retry the unchanged migration. Never mask an invalid/different index with
`IF NOT EXISTS`, mark a failed build applied, or drop a valid index automatically.
Keep staging and production statuses separate and preserve unrelated rollout work.

## Evidence and execution log

- [Accepted implementation plan](../plans/2026-10-30-usage-sql-read-path.md).
- [Critique and qualification journal](../plans/2026-10-30-usage-sql-read-path-reviews.md).
- [Usage qualification commands](../../scripts/provider-usage-e2e/README.md).
- [Actual browser harness](../../scripts/accounts-reference-e2e/README.md).

| Environment          | Result               | Actual version | Next action                                                             |
| -------------------- | -------------------- | -------------- | ----------------------------------------------------------------------- |
| staging / production | No rollout attempted | Not verified   | Complete implementation qualification and select an authorized release. |
