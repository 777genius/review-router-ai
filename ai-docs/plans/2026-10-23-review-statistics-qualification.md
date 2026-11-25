# Review statistics qualification

This record covers PR #689 and the isolated review-statistics feature. It records
executed checks separately from remaining merge gates. The approved plan and its
four rounds of independent review are adjacent files. No production deployment
or live provider publication is claimed.

## Current integration

The current source includes main `21f903e7`, including Skills, MCP and workspace
settings. Statistics remains an early dashboard branch before unrelated account,
configuration, settings and skills loaders. The sole new schema migration is
`000144_review_statistics`, with unchanged statistics SQL; the complete checkout
contains 146 migrations. Exact extension admission preserves main's preceding
145-migration manifest and the existing historical/managed authority boundaries.

During final qualification, main advanced to `791fc927` through the independent
Grok issuer-code handoff change. That change does not modify statistics, Modular
composition, the schema or migration catalog. Local evidence below identifies
the tested source; final remote CI must qualify GitHub's combined PR merge ref
against the current main, with its actual merge parents checked before merge.

Core and assembly 0.7.0 were rechecked against the official npm registry on
2026-10-24 and remain the latest published versions. Owned consumers use typed
contracts, module declarations, required slots, checked preparation and factories.
The mandatory completion hook and the existing durable outbox provide the real
settlement event boundary. A coalescing state observer is not substituted for
reliable event delivery, and no unused subscription or resource owner is added.

The completion owner calls capture inside its winning CAS transaction. Capture
validates full, successful publication evidence and writes the compact versioned
`review.statistics.settled` event in that same transaction. The independent
handler validates the outer scope, projects atomically, and acknowledges only
after commit. Public application DTOs and ports remain JSON-compatible; Prisma
and host lifecycle wiring stay in composition/infrastructure.

There are two compact fact tables and one capture boundary. Counts start at the
recorded worker activation. No historical backfill, broker, service deployment,
rollup engine or legacy telemetry fallback is introduced. Provisioned GitLab CLI
and certified Hosted fork/direct-comment routes remain explicitly incomplete
sources. The initial activation requires the nonrolling old-owner drain in the
plan; this work does not execute that deployment.

## Fresh checks on the merged source

After a temporary environment reset, the already-published implementation and
recorded final corrections were recovered into the current main integration.
The checks below were rerun in the fresh environment; earlier killed processes
and interrupted browser runs are not reported as passing this source.

| Area                          | Executed evidence                                                                                                                                                                           | Result                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Dependencies                  | Normal approved pnpm 11.28.7 frozen install, supply-chain policies, genuine runtime preparation and Prisma 7.8.0 generation                                                                 | Passed; no manual dependency aliases or source stubs                                     |
| Schema                        | Supported Prisma deploy to a fresh stock PostgreSQL 17.10 cluster                                                                                                                           | 146/146 successful migration entries                                                     |
| Migration authority           | Exact complete checkout, preceding main catalog, historical and managed catalogs, negative unknown/tampered tail cases, release and rehearsal boundaries                                    | Seven suites, 341 tests passed                                                           |
| Statistics PostgreSQL         | Idempotent/concurrent projection, replay collision, tenant/owner/member authorization and revocation, UTC/coverage, original binding lifecycle, earliest metadata, opaque keyset pagination | 16 passed; one separate opt-in volume case skipped in this rerun                         |
| Production review E2E         | Genuine publication/fault recovery, required capture hook, explicit statistics dispatch and authorized SQL reader                                                                           | 11 passed; actual all-clear review produces one review, one distinct PR and zero issues  |
| Web tests                     | Real components, HTTP/server adapters, routing and early-loader boundaries, including main's Skills and Other sections; final framework, midnight and focus regressions                     | Eight files, 79 tests passed                                                             |
| Completion eligibility review | Actual completion use case and capture adapter, including terminal unapplied publication, no snapshot attempt and stable repeat advancement                                                 | Two suites, 20 tests passed; no production capture policy change                         |
| WEB Host architecture profile | Existing strict command and rejection cases, including the statistics Foundation qualifier                                                                                                  | 101 tests passed                                                                         |
| Modular composition           | Strict actual full worker/runtime closure with declaration checking plus existing/new compositions and negative missing-capability fixture                                                  | Native check passed; five suites, 19 tests passed                                        |
| Normal host typechecks        | Actual worker, API and web projects under native TypeScript 7.0.2                                                                                                                           | All passed; full web check completed in 57.13 s                                          |
| Normal host builds            | Worker and API builds, plus serial actual web/dependency builds                                                                                                                             | Passed; 33/33 uncached Turbo tasks for the web build                                     |
| Production Next build         | Normal Next 16.2.11 build with its native preflight and built-in TS6 validation retained                                                                                                    | Passed; compile, TypeScript validation, 42 static pages and route optimization completed |
| TS6 tooling                   | Explicit compiler-API/tooling project including the reconstructed browser harness and merged main tooling                                                                                   | Passed after the final harness assertions                                                |

The local runtime is supported Node 24.22.1; CI uses the repository's pinned Node
26.11.1. Serial dependency builds bound memory without changing checks. Native
compilation used the normal compiler wrapper and isolated 7.0.2 installation.
Next's TS6 compiler-API validation stayed enabled. No supplemental workflow,
compiler exclusion, ignored diagnostic or reduced validation was needed.

After the final review corrections and complete browser run, the normal
`pnpm exec turbo run build --filter=@reviewrouter/web --concurrency=1` was run
again. It passed all 33 tasks (18 valid dependency cache hits; the web build was
not cached), with Next compilation in 18.6 s, built-in TypeScript validation in
49 s and all 42 static pages generated. The wrapper recorded exit 0 in 245.31 s.
Hashes of all 2,782 tracked build inputs matched before and after the command;
the generated Next route reference was excluded from that source digest. Only
documentation changed during this final production build.

Fresh command, exit-code and log receipts are in ignored
`tmp/statistics-qualification/fresh-host-gates.json` and
`tmp/statistics-recovery/`. Those local files are not part of the deliverable;
the normal package commands and committed tests are the reproduction interface.

The production E2E creates its statistics event through actual accepted review
completion, then drains the genuine registered handler. It seeds neither the
statistics event nor the fact in that chain. Its all-clear source intentionally
has no issue occurrences. The feature PostgreSQL and capture contract suites
separately exercise issue projection and inclusion/exclusion semantics.

## Real browser qualification

The committed `scripts/statistics-e2e/` harness uses actual Next SSR and APIs,
the installed NextAuth encoder and real session callback, current membership
policy, PostgreSQL reader and Chromium. Sessions and compact fact fixtures are
synthetic and local. The application role has explicit SELECT-only grants and
read-only transactions; the separate test administrator changes fixtures.
Product authorization, routes and readers are unchanged.

The final full matrix passed on the merged 146-migration schema at
2026-10-24 09:05:47 UTC. Actual versions were Node 24.22.1, Next 16.2.11,
Chromium 153.0.8010.0 and PostgreSQL 17.10. The six populated captures at
1440/900/390 px in both themes were independently inspected by the UI critic and
root. Both genuine Recharts SVGs hydrated at every size, and horizontal overflow
was absent.

The full scenario passed exact 12/90/180 summary and every-day table values;
7/30/90 periods with the browser in Pacific/Honolulu; keyboard metric/severity
filters; all-severity KPI and review-ranking stability; distinct Major pages of
25 and 20 findings (45 unique); a repository-scoped page of 25 matching rows and
scope reset; escaped finding text; page-only 503/retry; empty and unavailable
states; actual SELECT revocation and SSR recovery; actual membership removal,
403 and whole-feature suppression; and fresh authorized reload recovery. Real
Base UI controls also passed severity focus restoration, explicit issue/repository
navigation focus, and report Refresh without scrolling back to the issue list.

There were zero browser page errors and zero external requests. The app exited
with code 0 during owned cleanup. The original capture boundary was restored
exactly, fixtures and the temporary read-only role were removed, browser/app
processes stopped, and temporary profile/build/Next route metadata were cleaned
up. The complete result, source hashes and twelve captures are in ignored
`tmp/statistics-e2e/run-2026-10-24T09-04-12.019Z-523bc714b797/`; the committed
harness reproduces the checks without those local artifacts.

The preceding fresh attempt stopped before browser launch because node-postgres
bound fixture `Date` values using the host's local timezone. That failed attempt
is retained as a failure. Fixture timestamps now bind explicit UTC strings,
with a preflight proving 90 reviews, 12 distinct PRs, 180 issues and no future
facts before Next starts. The successful full rerun used this corrected fixture.

Independent review strengthened the harness before execution: any unexpected
server exit before owned shutdown fails the result; cleanup handles descendants
of an exited leader within the run's own process group; every daily cell and
coverage label is checked against the known fixture; both issue pages must have
the requested severity and 45 unique rows in total; repository filtering must
return 25 rows all belonging to that repository. These are evidence corrections,
not observed product authorization defects.

The helper changes only disposable development compiler/cache/debug-map settings
and bounded cleanup. The result records scenario scope, source hashes, actual
versions, HTTP responses, runtime errors, screenshots, child termination and
cleanup. This is development-browser behavior qualification; the genuine normal
production build is separately verified above. It does not claim live OAuth login
or an external Action execution.

## Counting, replay and access findings resolved

- Capture requires terminal successful publication and validates the immutable
  outer workspace/repository envelope against its payload.
- External review questioned whether an unapplied publication could reach the
  mandatory successful-settlement hook. Two independent source traces verified
  that `SupersededNoEffect` becomes `PublicationNotApplied`, outside this hook.
  `CompletedSuperseded` means a successfully published review whose snapshot
  was superseded by a higher generation. Existing snapshot admission validates
  the same occurrence states and bounds lineage identifiers to 256 characters;
  finalization derives `findingCount` from the same occurrence array. Capture
  therefore retains invariant failures and atomic rollback instead of silently
  dropping a supposedly successful review from statistics.
- Availability and complete source coverage are separate: a newer source cannot
  hide older known activity; archived or deselected retained sources and Hosted
  binding history remain conservatively represented.
- Projection locks the original connection. A different live SCM binding is a
  permanent collision; normal unbind can drain accepted events only after the
  original canonical provider/source/external identity is verified. A physically
  deleted original connection is the intentional no-op.
- An earlier issue observation replaces its connection ownership together with
  timestamp, execution, title and severity. Both arrival orders and deletion of
  the nonwinning connection are tested.
- Actor/workspace/server-seed cache partitioning prevents cross-scope data reuse.
  Authorization rejection cancels and removes queries synchronously and hides
  the mounted dataset; a fresh authorized server seed can recover. Old unmounted
  callbacks cannot purge a newly authorized instance.
- The SSR section rethrows actual Next control-flow signals and logs only a
  fixed event with workspace scope for unexpected failures. Raw infrastructure
  details reach neither the browser nor this diagnostic. UTC instant formatting
  uses the zero-based `h23` clock, including `00:01` at midnight.
- Issue-panel focus and scrolling follow explicit user navigation. Refetching
  the report and changing period or severity do not move focus to the issue
  list. When new-filter loading remounts Severity or a user-initiated Refresh
  temporarily disables its button, focus returns only if it fell to the document
  body; another active control keeps focus. No previous-filter dataset is shown
  during loading.
- Cursor decoding now accepts bounded persisted opaque IDs without assuming the
  current projector's hash format. Timestamp, exact scope, shape and size guards
  remain; real PostgreSQL verifies continuation across tied timestamps.
- Both production E2E runtime constructors bind the real required settlement
  hook and activate capture after runtime validation. Default finalized-only
  fixture dispatch is retained, with the separate statistics handler registered.
- A finalized-event recovery assertion now pins canonical event type/version
  along with execution scope; the distinct statistics event shares that aggregate
  legitimately and must not be mistaken for it.
- The two Prisma repository relations explicitly map to their existing tenant
  foreign-key names. Genuine Prisma 7.8 validation and generation passed; the
  migration SQL and catalog checksum are unchanged.
- The Provider accounts C1 workflow now explicitly prepares the pinned native
  compiler after its intentional `--ignore-scripts` install. Other workflows
  were checked for the same prerequisite; no lifecycle or supply-chain policy
  was weakened.

## Earlier SQL volume evidence and limits

Before the temporary environment reset, an opt-in test exercised the actual reader
with 100,000 review facts and 100,000 issue facts in one measured workspace, plus
1,000 of each in an unrelated tenant. It recorded a seven-day report at about
516.16 ms, first filtered issue page at 3.70 ms, and continuation at 3.13 ms.
Actual-reader SQL was captured for eight EXPLAIN ANALYZE/BUFFERS plans. The issue
queries used the intended indexes and read at most 26 rows; broad aggregations
used sequential scans where PostgreSQL preferred them.

Those raw local files were lost in the environment reset. These are retained
historical measurements, not a new run on the merged source, concurrent load,
thousands-of-users throughput or a production latency promise. The aggregation
and paging SQL is unchanged by the later cursor/parser and catalog fixes, and the
committed opt-in test remains reproducible. No rollup or separate service was
added without measured need.

## Remote merge gates

The existing protected checks, including Quality Gates and Dedicated Release
Authority PG17 contract, remain in force. The final remote head must pass them;
queued, skipped, cancelled or rate-limited states do not count as successes.
Current PR checks and review threads are authoritative for the eventual merge.
No administrative bypass or production deployment is part of this work.
