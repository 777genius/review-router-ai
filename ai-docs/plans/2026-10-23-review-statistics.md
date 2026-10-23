# Review statistics

Status: design candidate 1; implementation starts only after four sequential
reviews by three independent critics per round. Requested by the owner on
2026-10-23. This plan follows ADR-005 and the existing dashboard architecture.

## Outcome and scope

Add a Statistics section to the existing authenticated dashboard, inspired by
the supplied reference: three summary metrics, daily review activity, daily
issues by severity, repository rankings and an issue list. Average time to merge
is explicitly excluded. Keep the current default dashboard section and reuse
the existing workspace switcher, React Query, Recharts and shared UI controls.

Every signed-in user can read their selected personal workspace or a workspace
where they currently hold membership. This is workspace review activity, not
PR-author productivity. Execution data does not reliably identify an author or
requester. Do not accept a client-supplied actor or replicate counters per user.
Nonmember repository-manager access does not authorize workspace-wide reports.

Keep this as an isolated feature in the modular monolith. No new service,
broker, analytics vendor, generic event framework, rollout flag, legacy fallback,
historical reconstruction from run-health summaries, or production deployment.

## Counting contract

| Metric | Definition |
| --- | --- |
| Total reviews | One execution with complete coverage and successful publication, settled as `completed` or `completed_superseded`. Real reruns count; retries and repeated delivery do not. |
| Pull requests reviewed | Distinct SCM repository identity and PR number in the selected interval, scoped to the workspace. |
| Issues caught | Unique issue lineages first reported by an eligible review: workspace + SCM identity + PR number + lineage ID. Eligible occurrence states are `new`, `reconfirmed`, `changed`; exclude carried, resolved, uncertain and human-suppressed occurrences. |

Findings are reported issues, not a claim that every finding is a verified bug.
Successful empty reviews count. Partial, failed, unapplied, stale, compensated
and unknown outcomes do not. Snapshot supersession does not erase a successfully
published review.

Use UTC calendar days and half-open intervals `[from, to)`, at most 90 days.
Presets are 7, 30 and 90 days; default 30. Compare against the preceding
equal-length interval. A zero previous value produces an honest absolute/new
activity label, never infinity. Fill empty days with zero. Compute period-wide
distinct PRs independently: daily distinct counts are not additive.

Issue severity vocabulary is `critical`, `major`, `minor`, `unknown`. The last
bucket is necessary because valid current projection envelopes can omit lineage
metadata. Never derive severity by parsing rendered Markdown. Bound title/path
metadata, render it as text, and use a neutral fallback title when absent.

## Durable write path and extraction boundary

Existing `ActionRunHealthReport` is attempt-based and lacks PR identity;
`ReviewSnapshot` is mutable latest-per-PR and expires. Neither is a statistics
ledger. Canonical inputs are the execution, immutable finalized artifact and
successful completion settlement.

Extend the completion repository's successful CAS transition with one database
transaction. An explicitly injected infrastructure hook captures a small,
versioned settlement event in the existing outbox within that transaction. The
hook is composed at the host; completion domain policy does not import stats,
Prisma, a broker or report calculations. The hook receives tenant/PR/execution
identity, the immutable source projection and the single settlement timestamp.
Capture compact eligible lineage metadata in the event so operational evidence
pruning cannot later make an accepted event unreadable. No model text, raw
responses, credentials or full review bodies enter statistics storage.

Register one dedicated `review.statistics.settled` version-1 worker handler. Do
not register a second handler for `review.execution.finalized` version 2: the
existing dispatcher maps each type/version to one handler. Add the new key to
both the known registry and the available worker handlers.

The worker calls the feature's idempotent projector. A unique execution fact and
the issue identities are committed atomically; acknowledge the outbox only
after that commit. Repeated delivery, worker restart, concurrent workers and
unknown commit responses cannot increase counts twice. Out-of-order settlement
delivery must retain the earliest source timestamp and corresponding metadata
for each issue. Existing outbox retries, claim fencing and dead letters remain
the operational mechanism. Report reads never drive projection work.

Two compact durable tables are sufficient initially: successful review facts
and first-caught issue facts. Use tenant/time indexes, a composite tenant-aware
repository relationship and keyset pagination. Read current/previous summaries,
daily series and bounded rankings through SQL aggregation; do not fetch raw
history into Node or browsers. No precomputed rollup layer until measured query
cost justifies it. Date windows, ranking limits and issue-page sizes are bounded.

Choose and test repository deletion/reconnection behavior explicitly. Physical
repository deletion removes its facts through tenant-safe cascading relations;
logical workspace deletion blocks all reads immediately. Stable SCM identity
prevents a renamed repository from becoming a different PR or issue identity.
The report must not depend on retained operational execution/artifact records.

Do not invent old history. Record an explicit statistics availability boundary
at installation and show a concise note for windows before it. There is no
automatic backfill from lossy historical health/snapshot tables.

## Modular composition

Create `packages/features/review-statistics` with framework-free counting/query
policy, small consumer-facing ports, application projection/report use cases,
Prisma infrastructure, a durable outbox adapter and public composition exports.
Keep HTTP/session adapters in web and worker wiring in worker. A future service
can consume the same versioned settlement payload and serve the same report
contract without changing review policy or React components.

Use published `@get-modular/core` and `@get-modular/assembly` 0.7.0. Replace the
removed `bindFactory`/`prepare.factories` API in the four existing consumers with
`implement`/`prepare.modules`, preserving their public behavior and profiles.
Use typed contracts, explicit roots and checked composition for the new feature.
Factories may construct objects; loaders do not start timers, connections or
servers. The host owns the borrowed database and worker loop.

Published observation 0.2.0 coalesces replaceable state, is not a durable event
stream and explicitly leaves event APIs for future work. Do not present it as
reliable delivery or add an unused watcher just to exercise an API. The meaningful
feature hooks are the typed transactional settlement hook and the modular
outbox handler capability. Native resource/watch APIs are only warranted if the
feature owns a real resource or has a real replaceable-state subscriber.

Qualify these compositions with native TypeScript 7.0.2 using the existing
isolated compiler pilot. A repository-wide migration of TS6 AST-based tools is
outside this feature; do not silently replace the root tooling API.

Add the feature to the existing architecture/Foundation scope, with a rejecting
test for a forbidden domain-to-infrastructure import. Do not weaken checks.

## Read contract and authorization

The server resolves the signed-in actor and verifies current personal ownership
or membership plus active workspace status on every report/issues request.
Repository filters and cursors are scoped to the same workspace and filter set.
No arbitrary user scope, support/operator bypass, or SCM manager-only grant.
Return bounded domain DTOs with numeric totals, UTC day series, repository
rankings, available-since date and cursor-paginated issue summaries.

Use private, no-store HTTP responses and parameterized SQL. Validate dates,
window limits, severity and cursor before querying. Report reads use a consistent
database snapshot so parallel projection cannot produce internally inconsistent
cards/charts/rankings. Safe repository/PR links derive from approved SCM metadata.

## Frontend

Add an early Statistics branch in `DashboardSectionContent`, before unrelated
account/configuration loaders. Server-render the authorized initial report.
Use a feature-local React Query adapter for date/filter changes and issue pages,
with actor/workspace/filter-scoped keys, abort signals and deliberate freshness.
Never show prior-workspace or prior-period placeholder data under new labels.
On authorization failure hide seeded/cached data and prevent its resurrection.

Split presentation into summary, review chart, issue chart, repository ranking
and issue-list components. Use three KPI cells and two chart sections containing
their rankings, with dividers rather than nested cards. The review selector
switches daily PRs/reviews; severity filters the issue chart, its ranking and
issue drilldown consistently. Top-level KPI totals remain all-severity and are
labeled accordingly. Issue rows show severity, bounded title, repository, PR
link and first-caught date. Use keyset pagination and reset it on filter changes.

Provide loading, initial-error, refresh-error, empty, no-issue and unauthorized
states; never convert failures into zero totals. Include keyboard controls,
textual severity legend, integer chart axes and an accessible daily-data table.
Inspect desktop/tablet/mobile and dark/light themes. No technical pipeline
details in normal UI, merge-time metric, infinite percentages or mock live data.

## Implementation ownership and verification

After four reviewed plan rounds, implement in isolated worktrees:

1. Backend feature, migration and durable capture/projector.
2. Get Modular upgrade, host/worker composition and architecture enforcement.
3. Frontend feature, server/API adapter and component tests.
4. Root integration, real PostgreSQL/browser qualification and final review.

One additive schema migration, one cohesive feature PR. Commit/publish reviewable
increments, resolve concurrent-main changes without touching unrelated PRs,
then remove draft status and merge only after relevant checks and review fixes.

Verification covers transaction rollback, repeated/concurrent delivery,
out-of-order issues, real reruns, excluded outcomes, unknown metadata, evidence
pruning, UTC boundaries, distinct PR semantics, tenant isolation and revocation,
bounded SQL and representative tenant volume. Run the four existing modular
composition suites plus new assembly/negative-boundary tests. Use disposable
PostgreSQL 17 and synthetic sessions with the real Next app and Chromium for
dates, filters, drilldown, mobile and both themes. Inspect screenshots and report
the actual evidence limits. No production credentials or repository creation
are needed for this feature's E2E.

## Review log

Four sequential rounds, each with data/security, architecture/scale and
UX/qualification critics, will be recorded in the companion review log. Every
round reviews the revised plan after the prior round's findings are reconciled.
