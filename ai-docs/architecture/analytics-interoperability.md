# Analytics interoperability — future design, not a deployed service

Status: proposal only. Owner plan:
[analytics extensibility](../plans/2026-10-31-analytics-extensibility.md).

## Ownership of truth

Statistics owns published review, distinct PR, issue lineage and coverage;
Usage owns spend eligibility, provider attempts, token missingness, currency
and valuation basis; History owns lifecycle/run identity. The catalog
describes facts already calculated by these owners. Any future BI query
must use canonical versioned read models, not reinterpret raw payloads.

## Candidate canonical fact envelope v1

| Field                                     | Contract                                              |
| ----------------------------------------- | ----------------------------------------------------- |
| `factId`                                  | Stable idempotency ID within an owning context        |
| `owner`, `schemaVersion`, `policyVersion` | Explicit evolution and reconciliation                 |
| `workspaceId`, SCM identity               | Tenant/PR ownership; cannot be reassigned by lookup   |
| `occurredAt`, `processedAt`               | UTC event time vs projection processing time          |
| `revision`, `operation`                   | Explicit insert/correct/delete or tombstone semantics |
| `unit`, `currency`, `basis`, `known`      | Correct aggregation of exact costs/tokens             |
| `sourceCoverage`                          | Supported source and completeness boundary            |

Do not add these columns or events merely for this document.

## Optional engines, independently added later

**ClickHouse read model:** consume validated canonical facts via existing
outbox or a tested backfill reader. At-least-once transport demands
idempotent immutable IDs and correction-aware projections. Replaying a
window must reconcile counts, money, distinct PRs, tenant scope and
deletions against PostgreSQL before switching reads. An asynchronous
ReplacingMergeTree merge alone is not proof of exactly-once aggregated cost.

**Cube or similar semantic layer:** query curated SQL views prepared by
the owning features. Define only approved measures/dimensions, time grains,
nullable values and currency/basis buckets. Security context and caches
must preserve actor/workspace/member authorization; a single technical
database login must never yield unrestricted tenant discovery.

Local/offline remains PostgreSQL-only. Neither service is mandatory,
installed or an authority for business truth.

## Operational completeness

The operator's `scripts/analytics-statistics-health.ts` reads counts of
the known Statistics outbox type and version without raw payloads. Run only
with an approved read-capable DATABASE_URL, optionally scoped via
`STATISTICS_WORKSPACE_ID`. Nonzero exit code indicates dead letters
(1) or an unreadable/invalid check (2).

Outstanding queue counts **do not** prove source coverage. Zero pending
does not establish a successful worker deployment or historical backfill.
After PR #760 deployment, inspect and safely re-drive the documented
affected events, then compare authoritative facts and report coverage.
This script does not mutate events, grant permissions or access production
by itself.

Performance: use existing PG17 Usage qualification and Statistics
source-to-browser E2E before creating any new benchmark framework.
Track latency percentiles and temp I/O under representative authorized
10/25/50 concurrent reads in an explicitly disposable environment, never
as a wall-clock CI pass/fail threshold.
