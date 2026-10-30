# Usage SQL read path: actual review journal

Scope: [Usage SQL plan](2026-10-30-usage-sql-read-path.md), follow-up to PR #743.
Date: 2026-10-30. Base: `533c040de09d2609c8ebb44474812e2b35f0e7ea`.
This journal records actual reviews and dispositions. The five review rounds of
the previous PR do not establish five rounds for this separate task.

## Round 1: proposed v1

Two independent critics reviewed the actual v1: SQL/accounting and architecture.
Their disposition required revision before implementation. The coordinator
relayed the findings below to the plan author; v2 addresses them. Acceptance of
v2 remains pending until those critics review the actual revised file.

| Finding                                                                                                         | Critic                            | v2 disposition                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sharing `includeSpend` could accidentally filter public `aggregateUsage` input, changing its existing contract. | Both                              | Explicitly restrict `includeSpend` to report/SQL selection. Public aggregation sums every supplied row and shares weights without filtering. Require direct nondispatched pure aggregation versus report regression. |
| Exact JS cursor ordering needed a concrete bounded expression before code.                                      | SQL/accounting                    | Adopt the proved hybrid bytea expression for call/run ordering and cursor predicates; ASCII/BMP fast path, supplementary UTF16-unit encoding, no permanent function.                                                 |
| Global ordinal sorting could impose unnecessary whole-period work.                                              | SQL/accounting                    | Preserve first-seen groups/costs with minimum call-before-summary rank plus native DB call ID; use `row_number()` only for a demonstrated need.                                                                      |
| Timestamp casts could change current raw day semantics, including admitted `24:00`.                             | SQL/accounting                    | Derive day from the original string prefix; retain original endpoint strings and Date.parse/tie semantics. Add bounded raw-day/precision regression.                                                                 |
| Transfer volume evidence alone would not establish query selectivity or expose repeated scans/spill.            | SQL/accounting                    | Include sparse member/run/provider/model cases and per-statement actual rows times loops, rows removed, buffers and temp spill on real PG17. Keep the no-`O(limit)`-scan claim.                                      |
| Family/coverage-heavy periods remain unbounded even with bounded full projection hydration.                     | SQL/accounting                    | Add family-heavy qualification and explicit manifest/coverage growth disclosure.                                                                                                                                     |
| The initial production-line estimate understated the required responsibilities.                                 | Coordinator, informed by research | Revise to tentative 700–1,100 production and 350–600 test/qualification lines. Reassess complexity instead of treating the estimate as a cap.                                                                        |

The architecture critic's public aggregation finding is addressed by the same
contract fix as the SQL/accounting finding; no extra abstraction or live policy
implementation is introduced to resolve it.

## SQL ordering proof inspected for v2

The SQL critic created local qualification evidence under
`tmp/usage-sql-followthrough/`: `utf16-proof-expression.sql`,
`utf16-proof-result.json`, `utf16-proof-ascii-plan.json` and `utf16-proof.mjs`.
The plan author inspected those files; they are scratch evidence, not production
code or a substitute for the planned real PostgreSQL qualification.

Recorded backend: PGlite 0.4.1 in memory, PostgreSQL version string 17.5, Node
v24.22.1. The result records 4,840 distinct IDs (4,579 supplementary), 52 separate
after-cursor checks, seven full traversal pages and all assertions passing.
The ASCII 100,000-row proof records zero supplementary split subplan loops.
These observations support expression correctness and fast-path execution only;
no actual application workload or real PG17 performance acceptance is claimed.

## Round 2: actual v2 accepted

Both GPT-6.1 Sol xhigh critics read the revised plan and this journal. The SQL
critic accepted the concrete UTF16 key, public aggregation contract, raw day
semantics, transactional stages and strengthened sparse/family-heavy evidence.
The architecture critic confirmed that its public-contract finding was resolved
and found no remaining material architectural gap or unnecessary abstraction.
Their acceptance covers the actual v2 design, not unexecuted implementation,
performance, browser, CI or deployment claims.

## Pending

- [x] SQL/accounting critic reviewed actual v2: ACCEPT.
- [x] Architecture critic reviewed actual v2: ACCEPT.
- [ ] Coordinator publishes the accepted plan before production implementation.
- [ ] Record implementation review, exact checked revision and actual validation
      evidence when those actions occur; do not predeclare them passed.
