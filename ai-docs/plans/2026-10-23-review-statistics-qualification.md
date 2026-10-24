# Review statistics qualification

This record separates verified behavior from remaining gates. It covers PR #689
and the isolated statistics feature; it is not deployment or production capacity
evidence. The approved plan and four-round review record are adjacent files.

## Current merged-source qualification — 2026-10-24

The current integration includes main `21f903e7`, including Skills, MCP and the
workspace draft-review setting. The unshipped statistics migration is now
`000144_review_statistics`; the complete checkout has 146 migration directories.
Its SQL is unchanged. The exact catalog extension preserves main's preceding
145-migration admission and the historical/managed authority boundaries.

The temporary execution environment was reset before the last local changes had
been published. The core implementation was already preserved in PR #689. The
known cursor, composition, E2E capture and catalog fixes were reconstructed on the
new merged source, with fresh qualification required. Earlier raw local logs and
screenshots referenced below were lost in that reset; their recorded outcomes
are historical evidence, not results for this new tree.

Fresh completed checks: the approved pnpm 11.28.7 frozen install, normal
supply-chain policies and genuine Prisma 7.8.0 generation; seven catalog,
authority and rehearsal suites with **341 tests passed**. The new source is being
requalified against a fresh real PostgreSQL 17.10 database, actual browser flows
and the full host/compiler/build gates. Those pending checks are not passes.

## Implemented boundary

The completion owner invokes a mandatory host settlement hook inside its winning
CAS transaction. The host validates full, successful publication evidence and
writes a compact `review.statistics.settled` v1 event to the existing outbox in
that transaction. The independently registered worker handler validates the outer
envelope, delegates to the feature projector, and acknowledges only after commit.
Public application contracts expose JSON-compatible DTOs and consumer ports.
Prisma and host lifecycle wiring remain in composition/infrastructure.

There is one additive migration, two compact fact tables and one capture boundary.
No backfill, new broker, service deployment, rollup engine or legacy telemetry path
is introduced. Counts begin at the recorded worker activation boundary. Existing
provisioned GitLab CLI and certified Hosted fork/direct-comment paths remain
explicitly incomplete sources. Initial activation requires the non-rolling old
completion-owner drain described in the plan; no deployment was performed here.

## Verified checks

| Area                        | Executed evidence                                                                                                                                                                                                    | Result                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Schema                      | PostgreSQL 17.10: all 141 baseline migrations, then actual `db:migrate:deploy` for `000142_review_statistics`                                                                                                        | 142 migrations applied                                                                                                 |
| Completion transaction      | Real full-schema completion repository suite, including hook/outbox rollback, concurrent CAS winner and partial-completion exclusion                                                                                 | 12 tests passed                                                                                                        |
| Host capture and handler    | Capture/parser limits, terminal publication and correction policy, immutable envelope scope, handler retry classification and production runtime wiring                                                              | 28 tests across three files passed                                                                                     |
| Existing source contracts   | Gateway, canonical GitHub Secrets, direct API/OpenRouter context and capture/handler contracts                                                                                                                       | Four suites, 70 tests passed; this includes overlapping host tests, not 70 additional independent end-to-end scenarios |
| PostgreSQL statistics       | Idempotent/concurrent projection, replay collision, earliest metadata, tenant/owner/member authorization and revocation, UTC boundaries, activation, deleted/rebound/unbound connections, coverage and keyset paging | 16 tests passed; optional volume case skipped in this final focused rerun                                              |
| Web components and adapters | Real React components plus API/server, dashboard boundary, filter and presentation tests                                                                                                                             | Eight files, 71 tests passed; subsequent focused cache-race suite passed all 12 component tests                        |
| Composition                 | Existing four Get Modular consumers and new statistics composition, missing capability and incompatible revision rejection                                                                                           | Five suites, 19 tests passed                                                                                           |
| Feature compiler routes     | Native TypeScript 7.0.2: five normal feature builds and five typechecks; strict declaration checking of compositions, statistics and new worker adapters                                                             | Passed; the later expanded full-host gate remains separate below                                                       |
| Tooling compiler            | Explicit TypeScript 6.0.3 legacy tooling project                                                                                                                                                                     | Passed; compiler API consumers retain TS6                                                                              |
| Boundaries                  | Existing strict architecture over 589 domain/application files and six statistics Foundation cases, including rejecting Prisma/type, composition, modular/domain and public infrastructure leakage                   | Passed                                                                                                                 |
| Dependency upgrade          | Published core/assembly 0.7.0 archive integrity and real pnpm 11.28.7 frozen lock validation with normal supply-chain policies                                                                                       | Passed; vendor-owned account-gateway transitive 0.2 dependencies remain isolated                                       |

Focused commands are reproducible through the normal package scripts,
`pnpm modular:qualify`, `pnpm foundation:qualify-statistics`, and Vitest on the
changed suites. Set `STATISTICS_TEST_POSTGRES_ADMIN_URL` to a disposable loopback
PostgreSQL admin database for the feature integration suite; CI now supplies it.
The completion suite uses the existing `REVIEW_ROUTER_TEST_DATABASE_URL` after the
full schema migration. No production credentials or external review publication
were used in these tests.

## SQL volume qualification

An opt-in PostgreSQL test inserted **100,000 review facts and 100,000 issue facts
in the measured workspace**, plus 1,000 facts of each kind in an unrelated
workspace. It exercised the actual report reader, filtered first issue page and
continuation page, with tied timestamps. Prisma query events captured the actual
SQL for eight `EXPLAIN (ANALYZE, BUFFERS)` plans.

| Operation                 | Measured local elapsed time |
| ------------------------- | --------------------------: |
| Seven-day report          |                   516.16 ms |
| First filtered issue page |                     3.70 ms |
| Continuation issue page   |                     3.13 ms |

Issue plans used the intended indexes and returned at most 26 rows (25 plus the
lookahead row). Broad aggregation over the synthetic current-period distribution
used sequential scans where PostgreSQL preferred them; summary and daily distinct
PR operations were approximately 261 ms and 215 ms in the recorded plans.
These are single-run local measurements, not concurrent production load,
thousands-of-users throughput, worst-distribution or latency guarantees. No
unmeasured scale claim is inferred from them. The raw local evidence from that earlier run was lost in the environment reset;
the committed opt-in test remains the reproducible qualification method.

## Independent implementation findings resolved

- Capture now requires terminal successful publication and validates the outer
  outbox workspace/repository envelope against the payload.
- A new repository's later activation no longer hides older known workspace
  activity; availability and complete source coverage are separate concepts.
- Archived/deselected connections and retained Hosted binding history continue
  to inform conservative coverage.
- Delayed events lock and retain their original repository scope. A different
  live SCM binding is rejected. Normal unbind can drain already accepted facts
  after checking the immutable canonical provider/source/external identity.
- When an earlier issue observation wins, its original connection wins together
  with its timestamp, source execution, title and severity. Both delivery orders
  and deletion of the nonwinning connection are covered by PostgreSQL tests.
- Authorization rejection cancels and removes scoped browser queries
  synchronously. A delayed purge cannot erase a newly authorized SSR seed.

## Final gates in progress

The `scripts/statistics-e2e/browser-qualify.ts` harness is being restored for the real
Next SSR/API/auth and PostgreSQL reader with synthetic local sessions and facts.
It must finish its interaction matrix and six 1440/900/390 px light/dark captures,
followed by visual inspection. The harness documentation distinguishes this from
a production Next build and from live provider execution.

The expanded `tsconfig.modular.json` includes the actual full `worker.ts` and
production runtime, and CI runs `pnpm modular:qualify` separately. Local full-host
attempts were killed under a shared 8 GiB memory limit; killed checks are not
passes. Normal actual worker/API/web and production build checks remain required.
CI and final browser results will be recorded here before merge.
