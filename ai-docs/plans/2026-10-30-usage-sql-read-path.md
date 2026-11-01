# Usage SQL read path: bounded projection reads with unchanged accounting

Status: **v2 accepted by the independent SQL and architecture critics after
revision; publication precedes production implementation**. Date: 2026-10-30. Base main:
`533c040de09d2609c8ebb44474812e2b35f0e7ea` (includes PR #743).
Branch: `feat/usage-sql-read-path-20261030`.
The user authorized the fix, review, verification, PR and merge. Deployment is a
separate action. The coordinator owns publication, GitHub actions and merge.
Actual review findings/dispositions: [review journal](2026-10-30-usage-sql-read-path-reviews.md).

## Outcome and scope

The tenant and operator Usage reports must return the same accounting results
while PostgreSQL returns aggregate data and a bounded observation page instead
of every full `UsageProjection` in the authorized period, which can span 366 days.
Reduce data crossing the database boundary; measure the actual reduction.

PR #743 improved `selectReportFacts` lookup complexity but deliberately left
full-period SQL reads/materialization unchanged. This is that separate follow-up.
Preserve existing report DTOs, public pure functions, authorization and `read(q)`.
Use one shared SQL reporting adapter for both live report paths.

No new service, cache, rollup table, feature flag, dependency, generic query DSL,
ingestion/backfill redesign, provider integration or dashboard redesign. Add an
index/migration only when actual PostgreSQL plans demonstrate a specific need.
Do not expand into the unrelated Gateway incident, prelease policy or Statistics.

Read ownership sources before implementation: root `AGENTS.md`, the maintained
Engineering Quality Standard, plans [57](../architecture/57-provider-usage-implementation-plan.md)
and [61](../architecture/61-provider-usage-overview-implementation-plan.md), and
the [PR #743 follow-through plan](2026-10-29-statistics-history-followthrough.md).
The old plan's exclusion of DB changes bounded that former PR, not this task.

## Preserved contracts

| Contract                    | Required behavior / current owner                                                                                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structural scope            | SQL applies tenant workspace, member actor, UTC `[from,to)`, route, purpose, binding and run before any reporting. `infrastructure/prisma-usage-store.ts::query`.                                              |
| Operator scope              | Configured operator workspace owner/admin authority under `FOR SHARE` locks; aggregate active workspaces only. Never infer authority from a tenant selector. `prisma-operator-usage-report-reader.ts::report`. |
| Authority before dimensions | Resolve all structural summaries/children before exact requested provider/model predicates. Apply dimensions independently to selected spend and original attempts. `application/report-usage.ts`.             |
| Family completeness         | Exact manifest entry count, both parent scope and invocation correlation, every child usage complete. Missing/null/unknown/partial children keep summary authority. `domain/usage.ts::selectReportFacts`.      |
| Conflicts and duplicates    | Global overlapping manifests fail even for missing children or filtered models. Preserve duplicate pure inputs, object identity and original child order independently of manifest order.                      |
| Partial/unbounded           | Suppress correlated children when summary is selected; count them separately. Unbounded summaries add no spend and retain independent calls. No subtraction or allocation to children.                         |
| Spend and attempts          | Keep the current prepared/nondispatched/unknown dispatch rules. A stale prepared lifecycle must not erase later native usage. Original attempts remain independent of summary suppression.                     |
| Public aggregation          | `aggregateUsage(rows, attemptRows)` sums every supplied spend row; it does not select report eligibility. Only the report builder/SQL spend channel applies `includeSpend`.                                    |
| Distinct runs               | Period/overview logical runs count distinct nonnull original run IDs, including prepared observations. Never sum distinct counts across profiles/days/models.                                                  |
| Legacy groups               | Preserve observed provider fallback, observed model/null, selected day and selected-only attempt/run denominators. Do not silently replace them with overview semantics.                                       |
| Nulls and money             | All-unknown token sum stays null; known zero stays zero; retain both unknown counters and safe-integer overflow. Decimal money stays exact by currency/basis.                                                  |
| Facets and annotations      | Facets cover the full structural period before dimensions. Run annotations/routes/identities and direct/null-run markers preserve original attempt membership.                                                 |
| Pages                       | Observation and run cursors are independent. Totals/rankings/charts remain full period; each run aggregates all matching observations, not a call page.                                                        |
| Safe output                 | Full page projections and browser DTO redaction retain current authority, durations, requested/observed identities and nullable values. No new internal identifiers in browser output.                         |

## Concrete application and domain seams

Generalize the existing selector over a narrow structural input; retain its one
algorithm and return the same input objects. Required identity fields are call ID,
granularity, parent scope and invocation ID; usage needs nullable child manifest
and completeness. DB metadata additionally carries requested provider/model for
partial/unbounded dimension counts. Full `UsageProjection` remains assignable.

Introduce a concrete application-owned `UsageContributionProfile`:

```ts
interface UsageContributionProfile {
  granularity: UsageIdentity["granularity"];
  purpose: UsageIdentity["purpose"];
  usage: Pick<UsageFact, "state" | "dispatchEffect" | "completeness"> | null;
  lifecycle: Pick<UsageFact, "state" | "dispatchEffect"> | null;
}
interface UsageContributionDecision {
  includeSpend: boolean;
  providerAttempt: boolean;
  partialWeight: 0 | 1;
  unknownWeight: 0 | 1;
  diagnosticWeight: 0 | 1;
  summaryWeight: 0 | 1;
}
```

One TS classifier owns those decisions, including the existing
`provenNotDispatched` behavior. `includeSpend` filters only report selection/SQL
spend candidates. Public `aggregateUsage` continues summing every caller-supplied
row, even nondispatched ones; it reuses the counter/attempt weights without
applying this new filter. Neither wrapper changes the other's contract.
The SQL reader fetches DISTINCT actual raw profiles, classifies them in the
application, then binds a profile-to-flags relation using parameterized
`VALUES`/`jsonb_to_recordset`. SQL joins decisions and performs arithmetic;
it must not encode a second dispatch/completeness policy or an expression DSL.
Nullable usage and nullable lifecycle must remain distinct from prepared states.

Define a small typed aggregate result owned by application: bucket identity and
dimensions, nullable exact token sums/non-null counts, row and weighted counters,
distinct run count, exact currency/basis subtotal and first occurrence rank.
Annotation sets and timestamp endpoints are returned for their actual buckets.
Share finalization of safe token sums, unknowns and decimal formatting. Do not
create synthetic or partially populated `UsageProjection` objects for totals.

Keep `buildUsagePeriodReport`, `aggregateUsage` and their exports compatible as
pure capabilities/reference builders using those same helpers. Both production
readers use the shared SQL path; no runtime full-period fallback or alternate
production accounting implementation. Keep `read(q)` filtering and pagination
unchanged. Current pure-builder production callers are only the two readers;
other direct callers are tests/composition fixtures.

## Read stages and snapshot

Validate the query once, then execute all report stages on one transaction client
with explicit `RepeatableRead`. Retain operator authorization and share locks in
that same transaction. A child/correction arriving between stages must not mix
summary authority, totals and hydrated rows from different snapshots.

1. Build one reusable parameterized structural scope for tenant or authorized
   operator reads. Every metadata, aggregate, facet, run and page query uses it.
2. Read all structural summary metadata and only manifest-referenced call
   metadata. Referenced children must satisfy the identical structural scope;
   an outside-actor/workspace/period/route/run child cannot complete a family.
   Preserve relative input order and global overlap detection.
3. Run the existing generalized selector. Obtain suppressed call IDs, selected
   summary IDs, partial children and unbounded summaries. Apply requested
   dimensions to counts only after selection; omit unrelated calls from metadata
   because they pass through as ordinary selected call candidates.
4. Discover/classify finite raw contribution profiles. Bind the decisions into
   SQL. Aggregate unsuppressed calls plus selected summaries for spend, and all
   original matching observations for attempts/runs. Preserve each legacy group's
   selected-only denominator. Count distinct after eligibility, never by summing
   profile-level distinct counts. Token/cost sums stay exact in PostgreSQL and
   are validated/formatted by the shared application finalizer.
5. Read requested facets from the full structural scope before dimensions.
   Build full-period daily/model/ranking/group aggregates with existing meanings.
6. Select at most `limit + 1` eligible observation IDs after the observation
   cursor; hydrate at most the returned page's full projections. Cursor presence
   comes from the extra ID, never a count of every projection fetched into JS.
7. Select at most `limit + 1` distinct run IDs after the independent run cursor;
   aggregate/annotate only page run IDs, including their complete matching calls.
8. Read current source, unattributed and grant-delivery coverage metadata in the
   snapshot, retaining existing tenant/member/operator visibility rules.

The adapter may combine compatible statements/CTEs for clarity, but must not
duplicate scope or policy across separate tenant/operator implementations.
No unparameterized IDs, manifest arrays, filters or profile decisions in SQL.

## Resolved ordering and raw timestamp decision

Adopt the proved hybrid UTF16 bytea key for both call/run `ORDER BY` and cursor
predicates, including cursor values absent from the table. For ASCII/BMP-only
strings use `convert_to(value, 'UTF8')`; for supplementary code points replace
each with its two UTF16 code units encoded as UTF8-shaped bytes. Keep the result
as bytea, never invalid UTF8 text. Split characters only on the supplementary
branch; use a scoped SQL expression helper, no permanent function or collation DDL.
This matches JS code-unit order where simple `COLLATE "C"` does not.

The SQL critic's local `tmp/usage-sql-followthrough/utf16-proof-expression.sql`
and `utf16-proof-result.json` show 4,840 IDs, 52 cursor checks and full traversal
parity in PGlite; its 100k ASCII plan has zero character-split subplan loops.
This proves bounded expression semantics/fast-path use, not real PG workload
performance. Preserve these cases in the actual adapter's regression seam.

Legacy group/cost arrays instead preserve first selected occurrence: original
native SQL call-ID order among calls, then summaries in their original order.
Carry the minimum `(call-before-summary rank, native DB callId)` per group/cost
bucket; do not require a full-period `row_number()` sort without a demonstrated
need. Overview keys/annotations retain JS ordering. Day keys use the original
`identity.occurredAt.slice(0, 10)` (SQL raw-string prefix), never a timestamp cast:
currently admitted `24:00` can normalize into a different date. Run endpoints
retain `Date.parse` millisecond ordering plus original-string ties (`Z`, `.0Z`,
`.000Z`); return original strings. Include bounded admitted raw day/precision
edge cases so a cast or timestamp reconstruction cannot silently change results.

## File ownership and implementation checklist

| Owner seam                                                                                   | Bounded change                                                                                                       |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `packages/features/provider-usage/src/domain/usage.ts`                                       | Generic narrow selection input, unchanged selection policy.                                                          |
| `src/application/usage-totals.ts` and a focused report aggregate module if needed            | Profile classifier, typed aggregate contract, shared exact finalization; existing pure capability preserved.         |
| `src/application/report-usage.ts`, `usage-overview.ts`, `ports.ts`                           | Assemble existing DTOs, share ordering/finalization where useful; no Prisma imports or changed public query meaning. |
| `src/infrastructure/` shared report adapter                                                  | Structural scope, profile/family reads, SQL arithmetic, bounded pages, snapshot client; no second business policy.   |
| `prisma-usage-store.ts`, `prisma-operator-usage-report-reader.ts`                            | Delegate reports; retain ingest, direct `read(q)`, operator authority and metadata behavior.                         |
| Existing feature/server/API tests and `scripts/provider-usage-e2e/`                          | Risk seam parity and opt-in SQL qualification; reuse browser harness.                                                |
| `packages/platform/db/prisma/schema.prisma` and migration `000155_usage_member_report_index` | One measured member-scope index; no additional run/model indexes.                                                    |
| `ai-docs/deployments/`                                                                       | Implementation task plus index entry with both environments pending and actual verification/rollback requirements.   |

- [x] Publish this plan before production changes; coordinator uses the GitHub
      plugin if CLI authentication is unavailable. Do not claim publication from
      a local file alone.
- [x] Independent SQL/accounting and architecture critics review the actual v2;
      resolve their findings and record the accepted revision first.
- [x] Implement the shared policy contract, SQL path and both reader delegates.
- [x] Add only the risk seam tests below; inspect the diff for accidental scope.
- [x] Verify focused seams, migrated PG17 and the four browser journeys; record
      failed attempts and precise source/fixture boundaries in the journal.
- [ ] Obtain required CI and guarded merge verification on the published head.
- [ ] Record deployment task, measured evidence, independent implementation
      review, remaining limitations and final main/head/CI checks before merge.

Target estimate: 700–1,100 production lines and 350–600 test/qualification lines,
tentative rather than a cap. Reassess complexity if exceeded; do not sacrifice
semantics to meet an estimate or add a reporting framework to reuse one query.

## Measured implementation refinements

The real PostgreSQL qualification rejected the first SQL shape: per-observation
JSON bucket expansion caused wide external sorts and exceeded the existing
five-second transaction budget. The final adapter has six fixed native grouping
branches sharing one arithmetic expression; it constructs JSON bucket keys only
after aggregation. Profile discovery still returns the application profile and
uses the one TS classifier; joins bind its fixed seven-field tuple rather than
rebuilding nested JSON objects for every observation.

Measured observation-page compilation also justified `set_config('jit','off',true)`
inside the existing report transaction. It changes neither the pooled session
nor global database configuration, and adds no environment setting. Qualification
replays the actual scoped setting; it does not raise the production timeout.

The before/after member probe then demonstrated six full scans for roughly
100 authorized rows. One B-tree on `(workspaceId, actorId, occurredAt)` reduced
the same report from 275.28 to 17.35 ms and narrowed each stage to those actor
candidates. Migration `000155_usage_member_report_index` is a single unwrapped
`CREATE INDEX CONCURRENTLY`; actual pinned Prisma 7.8 migration rehearsal has
passed on fresh PostgreSQL 17 fixtures. The exact migration must also be admitted
as a checksum-bound checkout-only extension by existing rollout catalogs,
while historical managed inventories and transaction-wrapped additive windows
remain unchanged. Separate run/model indexes remain outside
this task. See the review journal and deployment record for actual evidence,
index validity/recovery and the remaining full-period/family cardinality limits.

## Verification and acceptance

Use a small adversarial full-result comparison against `buildUsagePeriodReport`
plus independent fixture arithmetic; matching two copies of one new algorithm
is insufficient. Preserve existing duplicate/order pure tests. Required seams:

- Mixed-provider/model complete and partial families, missing/wrong-correlation
  children, globally overlapping absent manifests, unbounded summaries and scope
  excluded children; verify authority, partial counts, attempts and facets.
- Prepared/stale/nondispatched/unknown dispatch profiles; same run across profiles,
  days/models/routes; period distinct runs versus legacy selected-only groups.
- Direct nondispatched `aggregateUsage` input still contributes tokens/cost while
  the same projection's report excludes spend; attempts retain their old rules.
- Null versus zero, partially known token fields, exact twelve-place money,
  currencies/bases, large costs, token overflow and requested/observed identity.
- Independent cursors and full run totals, first-seen groups/costs, punctuation,
  mixed case, `\uE000` versus `\u{10000}`, timestamp precision ties, and admitted
  raw `24:00` day spelling versus its normalized timestamp/date.
- Tenant admin/member/personal-owner redaction, foreign/inactive scopes, operator
  membership revoke/deletion, and a real concurrent-writer snapshot regression.

Extend existing PGlite tenant GET/operator SQL seams for fast semantics and real
PG17 feature tests for migrated schema, isolation and plans. Update test transaction
adapters honestly; PGlite alone is not evidence of concurrent PostgreSQL behavior.
Focused package/server/API checks precede repository-required pinned-toolchain
typecheck/lint/format/architecture/test/build gates as applicable to the diff.
Record actual commands, revisions and failures; never label a skipped lane passed.

Run opt-in qualification in a dedicated disposable PG17 database: at least
100,000 in-scope calls plus unrelated tenant/out-of-period rows, representative
families and repeated report dimensions. Include sparse member/run/provider/model
filters and a family-heavy fixture; disclose manifest/coverage output growth.
Compare small-fixture full results; on large fixtures record baseline/new rows
and JSON bytes, projection count and timings. For every actual statement capture
`EXPLAIN (ANALYZE, BUFFERS)` with scanned rows times loops, rows removed, buffers
and temp spill. Returned-row reduction alone does not prove less DB scanning.
Assert hydration is at most page size. No flaky wall-clock CI gate; add an index
only for a demonstrated plan problem and remeasure that exact risk.

Reuse `scripts/accounts-reference-e2e/src/tests/provider-usage.spec.ts` with actual
Next/Chromium and isolated database: existing independent 111 attempts/107 runs/
858 tokens, cursor/filter journey, member 50-token scope and foreign 403 remain.
Use its loopback network guard. Joined Action/native transport or live provider
tests are unnecessary unless implementation unexpectedly changes ingestion.

## Honest bounds, rollout and merge

Selection metadata grows with summary count plus referenced child IDs, not only
page size. Facets, model/day/group arrays and grant-coverage output can still grow;
run output is paged. PostgreSQL still scans the authorized underlying period and
JSON fields for aggregation; this does not establish an `O(limit)` DB scan or
arbitrary-cardinality safety. Further rollups require a separate measured need.

Create/update the deployment registry task during implementation: ordinary
coherent Web/feature rollout, any demonstrated migration prerequisite, authorized
journey verification and rollback to the previous application version. Leave
environments pending until actual rollout evidence; merge/CI is not deployment.

Before merge, review the integrated diff for Clean Architecture, SOLID/DDD/DRY,
scope consistency, one policy owner and remaining measured debt. Refresh exact
main/head/merge-base, reconcile concurrent changes, rerun checks only as needed,
inspect required CI and final independent review evidence, then merge under the
user's authorization. Report actual API/build/browser/merge/deployment evidence
separately; never infer deployed behavior from local tests or a green PR.
