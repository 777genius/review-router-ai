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
- [x] Coordinator publishes the accepted plan before production implementation:
      `3b481b00da4104533764c2e033a9925c8b0c82b0`, draft PR #746.
- [ ] Record implementation review, exact checked revision and actual validation
      evidence when those actions occur; do not predeclare them passed.

## Implementation review and measured corrections

The SQL critic independently accepted the domain/application implementation;
the architecture critic reviewed the integrated SQL/accounting/isolation path.
They identified and resolved the following bounded changes before publication
of the production implementation:

| Finding                                                                                 | Resolution                                                                                                                                              |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Internal classifier/aggregate contracts had unnecessary public re-exports.              | Removed the new re-export blocks; the existing public report contract remains stable.                                                                   |
| The new adapter and direct internal app imports needed explicit Foundation ownership.   | Added them to existing `usage.infrastructure`/`usage.application` entrypoints, without a new boundary or broader allowances.                            |
| SQL collected observed-model arrays for buckets that never consume them.                | Collect those arrays only for model and run outputs.                                                                                                    |
| Initial JSON bucket expansion exceeded the actual five-second transaction budget.       | Replaced roughly fivefold expanded wide sorts with fixed native grouping branches and post-aggregate JSON keys.                                         |
| Page JIT compilation and nested profile-key construction consumed the remaining budget. | Scope JIT off to the report transaction and use a fixed seven-field profile tuple derived from the same classified profile; keep the timeout unchanged. |
| Sparse member reports still scanned the entire table repeatedly.                        | Measured one actor-scope index before introducing migration155; defer unrelated run/model indexes.                                                      |

The critics independently accepted tuple null/prepared-state preservation and the
exact single-statement concurrent-index DDL. No second accounting policy, generic
query framework, new service, feature flag or cache was introduced. The six real
PG risk cases reuse the existing migrated fixture. Test/qualification line count
exceeds the initial estimate because it includes actual query capture, exact
accounting fixtures and opt-in EXPLAIN evidence; the reviewers found these risk
proofs useful and did not treat the estimate as a cap.

### Actual focused correctness evidence

On the working implementation before migration155, current tuple/JIT code passed
16 real PostgreSQL17 tests (one explicitly skipped opt-in volume test), including
the concurrent-writer snapshot regression, operator revoke/deletion, excluded
actor children, Unicode cursors, raw day spelling, exact money and overflow.
Tenant GET/operator PGlite seams passed 12/12; pure domain/application suites
passed 29/29. Feature native typecheck and complete Web native typecheck passed.
These are separate receipts, not a claim that deployment or the final committed
head's required CI already passed.

Initial PGlite failures exposed missing relational columns in its operator
fixture; its real transaction/columns were corrected. One independent manual
legacy-group expectation incorrectly assigned missing-provider observations to
the observed-provider bucket; full-result oracle parity had passed, and the
expectation was corrected. Failed receipts were retained rather than relabeled.

### Real PostgreSQL volume evidence before the member index

The successful fifth measured candidate used PostgreSQL17.11, Node24.22.1,
100,000 ordinary in-period calls, 100 mixed summary families, 100,000 foreign or
out-of-period calls, and a separate 1,000-family fixture. Its source-content
manifest includes untracked implementation files, so the plan-only HEAD is not
misrepresented as the implementation revision. Exact commands and repeatable
fixture boundaries are in `scripts/provider-usage-e2e/README.md`.

| Case               | Old full-projection JSON bytes | New returned stage JSON bytes | Hydrated full projections | New report ms |
| ------------------ | -----------------------------: | ----------------------------: | ------------------------: | ------------: |
| Full period        |                    150,997,421 |                       609,161 |                        25 |       3,675.8 |
| Member             |                        148,911 |                        71,220 |                        25 |         286.2 |
| Run                |                        149,001 |                        60,136 |                        25 |         251.5 |
| Requested provider |                    150,997,421 |                       317,043 |                        10 |         569.2 |
| Requested model    |                    150,997,421 |                       317,043 |                        10 |         658.3 |
| Family heavy       |                     17,323,161 |                     3,353,701 |                        25 |       1,560.2 |

All six cases and a separate large cursor/limit-invariance request completed with
the unchanged production transaction budget. Full-period transfer fell 99.597%.
Family-heavy output still contains 10,612 narrow stage rows versus 10,500 old
projections: metadata remains proportional to families, despite 80.64% fewer
JSON bytes. This is deliberately not a fixed-response-size claim.

Actual SELECT/WITH plans, bound parameters, scans/loops/removed rows, buffers,
JIT settings and spill were captured. Aggregate EXPLAIN fell from 8,675 to
2,793 ms across corrections; final full aggregation still wrote 11,105 temporary
blocks. Old baseline timings include SQL read/driver decoding/JSON byte accounting
and exclude old JS aggregation; they do not support an overall speedup claim.
The full report still scans authorized facts in PG; admin run/model filters can
retain table scans. No production percentile, arbitrary-load or uptime claim is
made from this synthetic fixture.

### Measured actor index and review

Before introducing maintained DDL, the same member SQL, parameters, complete
report and local JIT setting were compared with and without exactly one B-tree:

| Measurement                              |        Before |                        After |
| ---------------------------------------- | ------------: | ---------------------------: |
| Member report ms                         |        275.28 |                        17.35 |
| Aggregate statement ms                   |         44.81 |                         3.23 |
| Rows visited by each of six scope stages | About 211,550 | 100 indexed actor candidates |
| Sum of statement-root shared hits        |        97,090 |                          734 |
| Sum of statement-root shared reads       |       213,798 |                            0 |

Returned rows/bytes remained 109/71,220 with 25 hydrated projections. The synthetic
index built in 227 ms and occupied 2,793,472 bytes; repeated fixture keys favor
B-tree deduplication, so these are not production sizing estimates. The index
adds storage/build work and maintenance on inserts/non-HOT updates. Both critics
accepted this concrete tradeoff for the mandatory member privacy predicate.
Unlike post-authority model filtering, that predicate narrows every structural
read stage. Other indexes remain out of scope.

Migration155 and the Prisma schema declaration match. The
[deployment task](../deployments/2026-10-30-usage-sql-read-path.md) requires actual
index validity checks, migration recovery for an interrupted INVALID concurrent
build and coherent application rollout. Both environments remain pending.

### Remaining final gates

- Execute the actual pinned Prisma7.8 migration runner on a fresh disposable DB.
- Qualify the committed candidate with migration155 and actual Next/Chromium,
  inspect its screenshots, and record exact revision/receipt boundaries.
- Obtain final independent acceptance and required CI on the exact reviewed head.
- Perform the authorized guarded merge and independently verify its result.

Local positive architecture/Foundation checks passed. The unrelated memory
negative-fixture qualification encountered reappearing temporary fixture files
even after successful unlink calls; exact probes and syscall evidence were
preserved and only declared disposable probes removed. Its rules/source were
not changed. This local failed lane is not reported passed; the unchanged full
required architecture lane must pass in CI on the committed candidate.
