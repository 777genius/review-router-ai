# Analytics extensibility — design critique record

Date: 2026-10-31. Initial main: `a8ac2ea2842e76ff64d82993224cbe71a7498a75`.
Scope: [plan](2026-10-31-analytics-extensibility.md).

**Method:** Two separate critical reading passes by the assistant with actual
repository interfaces, code and active PRs inspected. Dedicated subagent/model
delegation is unavailable in this runtime, therefore **no independent model
review is claimed**. At design-review time, implementation code and CI
review remained future work. PR A implementation is now present in #768;
verification and deployment are tracked separately.

## Round 1: policy correctness / Clean Architecture / DDD

Initial proposal: unified metrics metadata, flexible selector with any
dimension, outbox status and future OLAP outlet.

Findings and fixes:

- **Unsafe groupings**: the current report provides complete daily values
  but only top-five repository rankings. Removed arbitrary group-by and
  forbade treating top-five as total universe.
- **Wrong aggregation semantics**: daily unique PRs, percentiles and rates
  are not additive; costs from different currencies/bases cannot be summed.
  Explicit grain, unit, aggregation class and original owner in descriptors.
- **Duplication**: generic analytics repository or second accounting engine
  would copy Review/Usage policies. Keep DTO computation and reader ports
  with feature owners; shared layer describes existing outcomes only.
- **Ambiguous coverage**: report generation time does not prove outbox has
  drained. Require separate freshness signal and UI disclaimer.
- **Unsupported metrics**: failed/success rate, quality score and
  cost-per-successful-review need different factual populations. Defer until
  authoritative inputs are defined.

Disposition: revise; all five issues addressed in v2.

## Round 2: security, operations, lean implementation

Reviewed revised scope against `AGENTS.md`, existing `Reader` ports,
Get Modular composition, live PRs and available frontend controls.

Findings and fixes:

- **P0 duplicate work**: #760 is already merged. No new fix branch; production
  replay and runtime grants require operator evidence, not inferred success.
- **Tenant authorization/cache**: unfiltered metric or BI query could bypass
  workspace/member scope. Keep server-authorized existing readers, fixed
  capability whitelist and private-query cache invalidation; do not embed
  arbitrary analytics SQL.
- **Too much for v1**: charts already use Recharts and Usage has a metric
  selector. Extend the smallest missing path; no new dashboard framework,
  database schema, services, flags or storage abstraction.
- **Operational creep**: new queue metrics/alerting backend isn't justified
  by this task. Reuse existing diagnostics and run a read-only optional
  benchmark; avoid performance assertions in shared CI.
- **Future adapters**: ClickHouse/Cube capabilities are different and
  shouldn't share one adapter protocol. Document canonical fact envelope and
  read-model expectations only until a real integration is justified.

Disposition: **accepted** as the final design plan. At design-review time, no implementation,
actual external review, E2E, production replay or merge is implied by this
design acceptance.

## Execution journal (fill with real evidence)

- Plan publication: pending.
- PR A: pending.
- PR B: pending.
- PR C: pending.
- Production role/replay and deploy: not verified; operator-owned.
