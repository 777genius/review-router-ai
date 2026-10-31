# Analytics extensibility — bounded plan

Status: **accepted after two design-critique rounds**, implementation pending.
Date: 2026-10-31. Initial reviewed main: `a8ac2ea2842e76ff64d82993224cbe71a7498a75`.
Owner scope: `777genius/review-router-ai` · `Statistics / Usage / History`.
Review record: [analytics-extensibility-reviews](2026-10-31-analytics-extensibility-reviews.md).

## Goal

Make the **existing** statistics easier to extend and use, while leaving PostgreSQL,
React/Recharts and Get Modular in place. The same business metrics must remain
correct regardless of future read-side storage (ClickHouse) or presentation/semantic
layer (Cube, Superset, etc.). **Do not integrate those products now.**

Use three small, independently reviewable slices, avoiding a generic analytics
query engine, an additional service, new broker, ORM-free SQL DSL, migrations,
rollups or flags. Keep the existing UI and API behavior unless explicitly
extended below. Prefer backend/server components for initial authorized reads,
TanStack Query for interactive refetch, and the existing UI components.

## P0 prerequisite: real data before beautiful dashboards

- PR #760 (Statistics projector / worker privileges) is already merged.
  Do **not** recreate it in this initiative.
- Production **deployment and replay are not proven** by the merge. The
  [deployment registry](../deployments/README.md) and the runtime privilege
  checker are the authority. An operator must verify deployed version and DB
  grants, inspect affected Statistics dead letters, re-drive **only eligible
  events** with existing idempotent outbox handling, and reconcile fact counts,
  periods and coverage. Preserve audit evidence; do not fabricate history.
- This initiative may document or validate the safe procedure, but may not
  blindly mutate production, relax worker grants or widen the release scope.
  No analytics result is called complete when capture/backlog/source coverage
  has not been verified.

## Ownership and invariants

| Owner | Owns | Must NOT do |
| --- | --- | --- |
| `review-statistics` domain/application | Definition of published review, unique PR, first-seen issue, UTC period, severity and source coverage | Delegate correctness to generic chart or BI engine |
| `provider-usage` domain/application | Spend eligibility, family authority, attempts, unknown/null, money currency and basis, source coverage | Infer unknown as zero; aggregate across currencies/bases |
| `review-history` | Per-PR run lifecycle, identity and authorized drill-down | Pretend latest PR status equals all historical runs |
| Small analytics presentation/composition seam | Metric IDs/labels/units/capabilities, safe selection, view preferences | Import Prisma into domain/application, create second aggregation policy |
| SQL infrastructure | Tenant-scoped reads, exact aggregation, keyset cursors, snapshot consistency | Reimplement accounting policies for a second storage engine |
| React | UI state, URL, chart rendering, feedback and keyboard navigation | Decide permissions or completeness |

**Security:** derive actor, workspace and role on server; never trust metric ID,
repository/model/tenant from a client to expand scope. Preserve private-query
cache isolation and fail-closed behavior after 401/403/role changes. Auth must be
checked even for an empty result. No sensitive prompts, code, credentials, or
unnecessary raw telemetry in any analytics fact or log.

**Semantics:** daily distinct PRs are **not** additive across days; p95, rates,
ratios and unique counts must come from the correct population, not sums of
daily values. Published review reruns count, delivery replays do not. First
recorded issue lineage counts once. Usage provider attempts and selected spend
are different populations; costs require currency+basis and exact decimals.
Unknown vs measured zero remains distinguishable. Coverage and background lag
are not equivalent to the time a report was generated.

## PR A — typed catalog, no new query engine

1. Put simple readonly metric descriptors **next to their owner features**
   (Statistics and Usage application layer). Use stable versioned IDs,
   title/help text, unit, `grain`, aggregation class
   (`sum | distinct | ratio | percentile`), and explicit supported dimensions.
   Prefer `satisfies`, `as const`, discriminated unions to factories or
   runtime plugins. All descriptors describe **already computed** DTOs.
2. Statistics v1: published reviews, unique PRs, first-seen issues. Usage v1:
   known total tokens, provider attempts, known cost per **selected
   currency+basis**. Do not fabricate failed review counts, quality scores,
   p95 or cost-per-successful-review before their authoritative facts exist.
3. Export catalog metadata from each feature; a small UI composition layer may
   list it, but does not own accounting formulas. Keep owner-specific
   descriptors as single source of truth. Preserve existing `Reader` ports and
   response types. No new endpoint or independent `AnalyticsRepository`.
4. Verify stable IDs, permitted dimensions, coverage behavior and nil/unknown
   semantics with focused pure tests; preserve existing fixtures.

## PR B — useful flexible UI without arbitrary dimensions

1. Reuse existing Statistics daily bars, top-five repository rankings, issue
   drill-down and Usage charts. Add a typed metric selector where missing,
   readable metric definitions/aggregation limits and an explicit distinction
   between full daily totals and **top-five-only** repository lists.
2. Save Statistics chart metric (not the report's server filter) in the URL
   alongside existing days/severity; preserve other dashboard params, browser
   Back/Forward, Refresh and deep links. Reject duplicate/invalid values
   predictably and provide a recoverable default. Do not put private data in URL.
   Keep server date+severity selection canonical.
3. Make the UI gracefully show unavailable/partial coverage and unknown spend;
   do not draw an apparent zero where facts are missing. Keep existing
   keyboard/focus/SSR safeguards.
4. Support only existing data dimensions. No pretend full-repository group-by,
   user-definable joins, persisted dashboard builder or cross-workspace charts.
   Additional aggregation endpoints require a separately measured user case.

## PR C — trustworthy and measurable analytics

1. Reuse the existing runtime privilege/outbox diagnostics for **operator**
   processing/backlog visibility. Add a small, documented, bounded check
   dedicated to Statistics events if it can share those existing mechanisms;
   otherwise do not invent a separate alerting pipeline. User-facing report
   distinguishes capture-period coverage from processing freshness and never
   promises the queue has drained merely because `asOf` is recent.
2. Add lean query-latency measurement with fixed operation names and bounded
   values, avoiding raw SQL, user IDs, query parameters or sensitive fields in
   logs. Prefer existing observability; avoid a new telemetry vendor.
3. Optional, disposable benchmark for 10/25/50 simultaneous **read-only**
   queries with seeded PostgreSQL, separated by admin/member/filter conditions.
   Record p95/p99, error/timeouts, memory, PG plans and baseline resource
   assumptions. Not a flaky time-based required CI gate.
4. Document a **future** `analytics facts v1` interoperability envelope:
   owner, canonical fact/event ID, workspace/SCM identity, schema/policy version,
   occurred/processed timestamps, correction/deletion model, coverage, replay
   and reconciliation. It is a schema proposal, NOT a new event stream or tables.
   Future ClickHouse would consume idempotent canonical facts from outbox; Cube
   would query curated tenant-safe read models/views without owning policy.

## Two concise review rounds (completed before code)

The [review journal](2026-10-31-analytics-extensibility-reviews.md) records
both rounds and dispositions. No independent subagent was available in this
environment; these were two design-critique passes, not a claim that two
independent models executed.

1. **Correctness/DDD critique:** fixed distinct/non-additive semantics, cost
   grouping, source completeness and cross-feature data ownership; refused a
   new global analytics engine and unsound full-repository group-by.
2. **Operational/security/overengineering critique:** narrowed P0 to existing
   rollout and replay authority, required private scope preservation, moved
   metrics to feature application, scoped the UI to the existing DTOs, made
   performance benchmark optional, and removed premature ClickHouse/Cube code.

## Acceptance, verification and merge

- [ ] PR A: typecheck, domain policy/catalog tests; independent code review.
- [ ] PR B: maintained Statistics/Usage web tests and **real Next/Chromium +
      PostgreSQL** journey (dark/light/mobile, URL/Back/Forward, focus,
      authorization downgrade, unknown costs, coverage, drilldown).
- [ ] PR C: operator privilege/backlog safety and bounded read-only benchmark;
      no prod workload generated. No SQL fact changes without PostgreSQL
      correctness tests.
- [ ] Before each merge, inspect updated main, changed files, focused lint/
      typecheck/test, required CI and actual review feedback. Correct findings,
      squash merge at exact reviewed head and verify main contains the commit.
- [ ] Create one deployment registry entry per shippable implementation batch;
      environment status stays `pending` unless actual deployment verified.
- [ ] Honest release report separates implemented/merged, CI/E2E, pending
      production replay and deployment. No skipped test is marked passed.

## Change budget and stop conditions

Indicative, not a quota: PR A 120–250 product LOC / 150–300 tests;
PR B 250–600 product / 200–450 tests;
PR C 100–250 product/docs / 150–350 tests and benchmark.
Reassess scope at materially larger diffs: maybe an existing feature already
provides the capability. Avoid new packages and migrations unless necessary.
Stop on unverified operator permissions, an invalid DB migration, foreign
workspace leakage or a failing required CI. Do not bypass the gates.
