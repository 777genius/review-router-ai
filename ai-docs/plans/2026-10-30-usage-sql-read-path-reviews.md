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
- [x] Record implementation review, exact checked revision and actual validation
      evidence below; final merge gates remain separately tracked.

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

### Final gate tracking

- [x] Execute the pinned Prisma 7.8 migration runner on a fresh disposable DB;
      migration 155 completed and its exact index is ready/valid.
- [x] Qualify the committed SQL candidate with migration 155; all six cases and
      the additional independent cursor passed.
- [x] Complete the corrected local Usage overview browser scenario and visual
      review; all four distinct scenarios have successful receipts, and the
      separate exact-head CI followthrough browser lane passed.
- [x] Resolve the checkout migration admission failures; independent review and
      422 focused policy regressions passed.
- [ ] Obtain required CI on the final reviewed head.
- [ ] Perform the authorized guarded merge and independently verify its result.

Local positive architecture/Foundation checks passed. The unrelated memory
negative-fixture qualification encountered reappearing temporary fixture files
even after successful unlink calls; exact probes and syscall evidence were
preserved and only declared disposable probes removed. Its rules/source were
not changed. This local failed lane is not reported passed; the unchanged full
required architecture lane must pass in CI on the committed candidate.

## Published implementation qualification

The implementation was published as
`700a28d38c05788dbdc0d5ec284709ffea6e07bd` in
[PR #746](https://github.com/777genius/review-router-ai/pull/746).
Both independent GPT-6.1 Sol xhigh source critics accepted the corrected SQL,
application/domain ownership, authorization/snapshot boundary, disposable probe
and concurrent-index rollout instructions. Changed-file ESLint, formatting and
the native feature typecheck passed before publication.

The final normal opt-in PG17 qualification ran once against that exact clean
commit with migration 155 installed and the actor probe unset. All six cases and
the extra independent cursor passed under the unchanged five-second report
transaction budget. Total qualification duration was 42.20 seconds, including
fixtures, actual statement EXPLAIN plans and cleanup; the other 16 tests were
intentionally excluded by that test-name filter, not newly counted as passed.

| Case               | Old full-projection JSON bytes | New stage JSON bytes | Hydrated full projections | Report ms |
| ------------------ | -----------------------------: | -------------------: | ------------------------: | --------: |
| Full period        |                    150,997,421 |              609,161 |                        25 |  3,728.99 |
| Member             |                        148,911 |               71,220 |                        25 |     18.87 |
| Run                |                        149,001 |               60,136 |                        25 |    224.49 |
| Requested provider |                    150,997,421 |              317,043 |                        10 |    478.17 |
| Requested model    |                    150,997,421 |              317,043 |                        10 |    607.12 |
| Family heavy       |                     17,323,161 |            3,353,701 |                        25 |  1,639.73 |

The member aggregate used `UsageCall_workspaceId_actorId_occurredAt_idx`, visited
100 rows, removed none, recorded 103 buffer hits and executed in 4.251 ms. Full
aggregation still scans period facts and spills; the earlier cardinality and
baseline-timing qualifications continue to apply.

The source content manifest covered 194 source/schema/migration files, SHA256
`808319fc33ea6d4bef8a6bcc93d37b40381e6ac07547acb523456c0c82c28920`.
The working diff was empty. Local receipts and per-statement plans are retained
under `tmp/usage-sql-followthrough/qualification-final-indexed/`; earlier attempts
were preserved before the normal output directory was reused. An explicit admin
query verified that the suite-owned database was removed after the run.

### Actual migration and browser evidence

The exact-source GitHub
[Statistics Usage Reviews browser run 41071043620](https://github.com/777genius/review-router-ai/actions/runs/41071043620)
passed on `700a28d38c05788dbdc0d5ec284709ffea6e07bd`: ordinary Prisma 7.8 migrations
including 155, native compiler preparation, complete web typecheck, authenticated
followthrough journeys, receipt assertions and fixture cleanup. Its screenshot
and receipt artifact is
[12985131766](https://github.com/777genius/review-router-ai/actions/runs/41071043620/artifacts/12985131766).

The local Accounts harness also applied ordinary migrations to a fresh owned
PostgreSQL 17.11 database. Direct catalog inspection confirmed migration 155
finished with one applied step and no rollback, and that the ready/valid index
is exactly the three-column B-tree declared in the schema. The receipt is
`tmp/usage-sql-followthrough/browser-migration-155-receipt.json`.

Local attempts are kept distinct: the first selected zero tests because the
command anchored a title that Playwright prefixes with file information; the
second encountered Chromium's Unix-socket path-length limit. The corrected
selector is `ACCOUNTS_REFERENCE_E2E_GREP='provider usage '`. A short task-owned
`TMPDIR` resolved the confirmed socket issue without changing product or harness
security controls. The next actual run passed navigation, coverage and operator
scenarios, but failed the overview test on a stale bare-report API expectation.
The real API's established `{ scope, report }` response was already correctly
handled by the product and newer followthrough harness.

The focused test correction independently verifies the expected actor, workspace
and access in that envelope before unwrapping the report, including the member
case. It retains all independent arithmetic, cursor, null/zero and foreign-denial
assertions. The operator endpoint retains its own existing bare-report contract.
The correction passed harness typecheck, changed-file ESLint, formatting and
independent critical review; its browser rerun is recorded separately below.

### Required CI found a rollout-catalog integration gap

The implementation's first full CI Quality job stopped at unit tests because
migration 155 was not yet classified in the maintained checkout/rollout catalogs.
The feature and API tests in that job passed. This failure was not dismissed as
unrelated: adding the index requires explicit admission into these safety
boundaries as part of this implementation.

The bounded correction admits only the exact named migration and checksum as a
checkout-only tail. It must preserve the managed 92 and historical 96 inventories,
reject changed or unknown migrations and leave the transaction-wrapped historical
additive runner untouched. Migration 155 continues through the ordinary pinned
Prisma path outside an explicit transaction. Independent migration-policy review
accepted the actual corrected boundary and its negative cases before the next
publication. Ten focused pure/mocked test files passed, 422 tests in 6.46 seconds.
The earlier sandbox attempt exposed two historical-fixture assumptions, which
were corrected, and one native Git subprocess permission error; the exact
permission-enabled rerun passed. No PostgreSQL/role rehearsal was claimed from
those pure/mocked tests. No
required gate or production protection is disabled to obtain a green result.

### Completed local browser qualification and visual review

The four distinct Usage scenarios are qualified by successful actual browser
receipts, with the failed attempts retained rather than relabeled:

| Scenario                                                                                                                 | Successful evidence                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Full-period overview, arithmetic, independent pages, filters/custom dates, Refresh, member 50-token view and foreign 403 | `usage-sql-browser-overview-final`: 1 passed, 0 failed, 1.5 minutes             |
| Workspace navigation and stable totals                                                                                   | Passed in both `usage-sql-browser-qualified` and `usage-sql-browser-serialized` |
| Native lag and partial producer coverage                                                                                 | Passed in both runs above                                                       |
| Operator admin access, member denial and signed-out denial                                                               | Passed in both runs above                                                       |

All directories above are under `tmp/accounts-reference-e2e/runs/`. The final
corrected-harness runs used product source
`700a28d38c05788dbdc0d5ec284709ffea6e07bd` plus captured source diff SHA256
`28e41a16b1f62223aebd5e494f60a32f86ee256e347204f0ba452d64fb1fabe4`.
That diff is the reviewed API-envelope test correction; production Usage/Web
source and schema were unchanged. Those files are published together in the
follow-up candidate. The final required CI must still run on that published head.

A long initial corrected-harness run lost the Next port after successful API/UI
checks; the container recorded one OOM kill, without identifying its victim.
A serialized retry with a 2 GiB local Node heap produced explicit Next development
server output: its 80% used-heap threshold restarted the worker during a page
reload. That retry passed the other three scenarios and did not add an OOM kill.
The remaining overview then passed alone with a 3 GiB local Node heap, preserving
its 150-second test timeout and every assertion. Cgroup OOM counters stayed at
one before/after. The captured cgroup limit was 8 GiB; host free-memory reporting
had overstated usable headroom. This is a local development-server resource
qualification, not a production capacity measurement or new runtime setting.

The fresh migration proof belongs to `usage-sql-candidate` and the direct catalog
receipt. Subsequent browser attempts deliberately resumed only the harness's
three synthetic users/fixtures; their receipts correctly do not claim a new
fresh migration. No live OAuth/provider/native lifecycle qualification follows
from these synthetic-session, loopback-controlled UI/read tests.

The coordinator inspected desktop dark/light, mobile token and USD/EUR cost
captures. An independent critic inspected the 320px, 1024px, 640px/DPR2, mobile
runs, empty state and expanded Details captures, including readable portions of
the long Details page. Filters, primary actions, values, long labels, disclosures
and structural responsiveness were accepted without a product redesign. The
existing optional 100-run Details page can be long; it is not a new SQL regression.
Keyboard/focus assertions belong to the successful browser scenario; screenshots
alone are not a screen-reader or numerical contrast certification.

### Focused migration integration command

The following ten-file selection passed all 422 tests with pinned pnpm 11.28.7.
The successful stdout is retained in the agent execution result; no local log
file was saved, so no filesystem log is claimed. The final required CI remains a separate gate on the published head.

```bash
pnpm exec vitest run \
  scripts/lib/render-schema-handoff-policy.test.ts \
  scripts/lib/render-historical96-checkout.test.ts \
  scripts/lib/provider-key-checkout-admission.test.ts \
  scripts/lib/render-schema-handoff-transaction.test.ts \
  scripts/rehearse-private-pg17-rollout.test.ts \
  scripts/codex-rotating-release-migration-workflow.test.ts \
  scripts/production-additive-migration-window.test.ts \
  packages/features/release-rollout/src/domain/release-migration-transition.test.ts \
  scripts/check-codex-rotating-prisma-envelope.test.ts \
  scripts/lib/render-retained-exclusion.test.ts
```

### Additional opt-in CI catalog assertion

While checking superseded workflow results, the operator-grants S PostgreSQL
lane on implementation head `700a28d` exposed one more current-checkout assertion
in `gateway-configuration.postgres.test.ts`: it still expected 159 migrations and
a 22-entry tail ending at 154. Its real grants stage had already passed; this
finite inventory assertion was the sole failing test in that job. The correction
expects 160 entries and the exact 23-entry tail ending with migration 155.
Historical 159-row fixtures remain unchanged. A repository scan found no other
stale current-159 assertion, and independent review checks the actual test diff.
The subsequent exact-head operator-grants CI lane must supply its PostgreSQL
result; no new local PG run is claimed for this test-expectation correction.
