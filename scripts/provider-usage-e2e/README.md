# Joined provider usage verification

## Bounded policy-selection measurement

Run the opt-in pure-policy comparison independently of the database/browser
suite:

```sh
node --import tsx scripts/provider-usage-e2e/benchmark-selection.ts
```

One process compares the previous scan policy with the indexed selector on
10,000 calls and 1,000 summaries. The fixture includes complete, missing,
wrong-invocation, partial and unbounded families, with call order different from
manifest order. It asserts equal results, warms both implementations once, then
reports three serial timings, result counts, Node version and source hash. No
wall-clock threshold gates CI. This measures selection only and excludes SQL,
full-period JSON materialization and aggregation. The SQL qualification below
measures that separate boundary; output pagination alone does not bound its costs.

## Opt-in PostgreSQL report qualification

The SQL read follow-up uses the existing migrated, disposable feature test
database. Run this lane alone against a dedicated PostgreSQL 17 cluster; its
setup/cleanup creates cluster-global `reviewrouter_*` roles, so do not overlap
another migration or feature suite on that cluster:

```sh
USAGE_TEST_POSTGRES_ADMIN_URL=postgresql://USER@127.0.0.1:PORT/postgres \
USAGE_SQL_QUALIFICATION=1 \
pnpm exec vitest run packages/features/provider-usage/src/tests/prisma-usage-store.test.ts \
  --testNamePattern 'qualifies bounded report reads and actual scan plans'
```

The helper seeds 100,000 ordinary in-period calls, 50,000 foreign tenant calls,
50,000 older calls, a mixed 100-family period, and a separate 1,000-family heavy
period. Full, sparse member/run/provider/model, and family-heavy cases assert
independent token/attempt/run/cost arithmetic. A page of at most 25 full
projections must retain complete-period totals across independent cursors.
The actual report keeps its production transaction budget; this harness does
not increase the default five-second Prisma interactive transaction timeout.
After measured page compilation overhead, the report disables JIT only inside
its own transaction. The server default stays enabled. New-report plan replays
apply that exact captured setup in a short RepeatableRead transaction; baseline
plans retain the default setting. Receipts identify which setting each plan used.

Evidence goes to `tmp/usage-sql-followthrough/qualification/`: `result.json`
records the exact source commit, tracked diff hash, and file-content manifest
hash covering tracked **and untracked** feature code and Prisma schema/migrations.
It records returned rows, JSON re-encoding bytes, hydration count and timings
for each case. Baseline time
includes the former full-projection SQL read, driver decoding and byte accounting;
it excludes the old JS selection/aggregation, so it is not a full old/new latency
comparison. Byte accounting excludes database protocol framing.

Each actual SELECT/WITH statement, including the baseline, is separately executed
with `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`. Plans and summaries retain actual
rows times loops, filtered/join/recheck removals, buffer hits/reads, temporary
blocks and sort/hash spill details. Returned-row reduction alone cannot establish
lower database scan work. There is no wall-clock CI threshold or production
capacity claim. Summary manifests, facets/groups and grant-delivery coverage can
still grow; this lane does not establish an `O(limit)` database scan.

Small adversarial oracle parity, real concurrent-writer snapshot behavior and
authorization remain in the same feature suite. The actual Next/Chromium Usage
journey remains in the Accounts reference harness. This lane makes no live
provider, installed Action/runtime, deployed API or production rollout claim.

Measured on 2026-10-30 against PostgreSQL 17.11, default `work_mem=4MB` and
server `jit=on`: all six cases and the additional independent-cursor request
passed with the production five-second transaction budget. The full lane took
43.41 seconds including seeding, separate plan executions and cleanup. Source
commit was the published plan commit `3b481b00`; exact working feature bytes
(including new modules) have content-manifest SHA256
`ceecd7cd6b480291c2b649c8c5406f1b7bc914d89241d024fc0948cfca4b8b41`.

| Case               | Baseline JSON bytes | New stage JSON bytes | Full projections hydrated | New report ms |
| ------------------ | ------------------: | -------------------: | ------------------------: | ------------: |
| Full               |         150,997,421 |              609,161 |                        25 |       3,675.8 |
| Member             |             148,911 |               71,220 |                        25 |         286.2 |
| Run                |             149,001 |               60,136 |                        25 |         251.5 |
| Requested provider |         150,997,421 |              317,043 |                        10 |         569.2 |
| Requested model    |         150,997,421 |              317,043 |                        10 |         658.3 |
| Family heavy       |          17,323,161 |            3,353,701 |                        25 |       1,560.2 |

Full-period JSON transfer fell 99.60%; family-heavy transfer fell 80.64%.
Narrow metadata can increase returned row count: family-heavy stages returned
10,612 rows versus 10,500 old full projections. This is bounded full-projection
hydration and lower bytes, not a fixed bound on metadata/output cardinality.
The full aggregate still scanned the underlying period and used 37,626 temporary
read blocks/11,105 write blocks in its plan. Sparse member/run/model plans still
scanned and removed most table rows; the existing provider index selected ten
rows directly. These plans identify remaining selectivity work rather than
proving less database scanning or faster requests for every scope. These numbers
precede the single actor index justified by the comparison below; run/model
selectivity work remains deferred for the less common admin query paths.

Three earlier candidates failed the unchanged transaction budget, and a fourth
completed its first page but failed the additional cursor request. Receipts/logs
are retained as `attempt-01-*` through `attempt-04-*`; the successful receipt/log
are `attempt-05-passed.*`, alongside actual per-statement plan JSON. The final
native grouping, compact profile join key and measured transaction-local JIT
setting address those concrete failures. No timeout increase made the lane pass.

The accepted actor-index comparison used the same seeded database, report SQL,
parameters, complete result and JIT setting before/after an index on
`(workspaceId, actorId, occurredAt)`. Those equality assertions passed. Member
report time fell from 275.28 to 17.35 ms. Six scans of roughly 211,550 table rows
became scans of 100 actor candidates each; summed root buffer hits/reads across
report statements fell from 97,090/213,798 to 734/0. Aggregate execution fell
44.81 to 3.23 ms, with unchanged 71,220 JSON bytes and 25 hydrated projections.
The disposable index built in 227 ms and occupied 2,793,472 bytes on this
deduplication-friendly fixture; that does not predict production size/build time.
Receipt and actual plans are in `tmp/usage-sql-followthrough/actor-index-probe/`.
Migration `000155_usage_member_report_index` now installs this one proven index.

For a reproducible comparison after migration, add
`USAGE_SQL_ACTOR_INDEX_PROBE=1` to the same command. This lane validates the
existing suite's exact `TEST_usage_<32 hex characters>` database name, drops only
`UsageCall_workspaceId_actorId_occurredAt_idx` there, measures the member case,
recreates that same index, then measures identical SQL/parameters/results again.
Normal qualification retains the migrated index. The probe never alters an
application database; the name guard runs before any seeding in both modes.
All fixture data/indexes leave with suite cleanup.

## Joined transport and storage

Run from the RR repository root with a dedicated disposable PostgreSQL **17** cluster and the exact Action source checkout. Include the safe capture path for all three tests (without it, native replay is explicitly skipped):

```sh
USAGE_E2E_POSTGRES_ADMIN_URL=postgresql://USER@127.0.0.1:PORT/postgres \
USAGE_E2E_ACTION_ROOT=/absolute/path/to/provider-usage-action \
USAGE_E2E_NATIVE_CAPTURE=/absolute/path/to/usage-observations.json \
pnpm exec vitest run --config scripts/provider-usage-e2e/vitest.config.ts
```

Coordinate cluster ownership before running: migrations create cluster-global `reviewrouter_*` roles. This suite creates one unique `TEST_usage_e2e_*` database, snapshots pre-existing roles, and drops only its database/new roles afterward. It never reads application `DATABASE_URL`.

The test exercises actual Action `UsageDelivery` and Responses relay, real bounded loopback HTTP requests, production Fastify grant/report routes, Get Modular feature composition, full RR SQL migrations, Prisma durable facts/projections, and SQL tenant/member report filters. The upstream sends success usage (10 input / 3 output), HTTP 503, and a completed response without usage. Three real sends produce three attempts and thirteen known tokens. After the first delivery loses its ACK, execution authorization is revoked; the existing report-only grant still completes cleanup, while the stale execution token cannot mint another grant. Delivery loses one ACK after server commit; cleanup retries and empties signed pending facts without repeating inference. Replaying the acknowledged request leaves durable fact counts unchanged. A page size of one still reports complete-period totals.

Execution authorization and provider upstream are explicit local fixtures. Fixture setup bypasses unrelated baseline foreign keys only while seeding authorization/release records in a transaction; normal grant/ingest/report operations use unchanged production constraints. Price reader returns unknown rather than reaching a live public catalog. This is not proof of OIDC, live provider traffic, browser session authorization, browser operator sessions or installed immutable releases.

A lost delivery ACK remains a historical `partial/delivery_failed` producer coverage capsule after successful retry. The test checks both that capsule and an empty ACKed fact spool; it does not equate partial coverage with pending delivery.

Remaining joined acceptance:

- Real diagnostic Test connection through the deployed UI/provider path; the controlled fixtures separately cover diagnostic identity and Gateway aborted usage.
- Real dashboard/operator browser sessions (SQL operator authorization is verified here).
- Current immutable Action/runtime/SDK pins on an existing disposable GitHub repository and a bounded real configured provider request.

Read-only discovery on 2026-10-21 found `777genius/rr-codex-v2-e2e-20260814` accessible, with `.github/workflows/reviewrouter-codex.yml` active and pinned to RR `999da4783098b82faed1890ec80165c4a501d872`, calling `https://api.reviewrouter.site`. Existing run `31856987508` succeeded. This older hosted pin does not contain the current usage changes, so replaying it cannot qualify this implementation. No workflow was dispatched or repository changed. The older documented `777genius/review-router-saas-e2e` returned 404.

Controlled acceptance recorded on 2026-10-21: three joined tests passed against PG17.5 with dedicated database default timezone `Europe/Kyiv` and the actual platform client factory enforcing UTC sessions. Added real operator aggregate SQL: operator admin sees all authorized active workspace usage; foreign workspace admin and revoked operator membership are denied. Concurrent identical diagnostic issuance creates one canonical call without a conflict. With `USAGE_E2E_NATIVE_CAPTURE=/absolute/path/to/usage-observations.json`, the suite also imports actual remote native observations through the production Gateway source adapter and fenced reconciliation, expecting three attempts, ten known tokens, and one partial aborted request. The capture test establishes replay of those exact safe bytes; it does not claim one continuously connected remote-to-local request.

The isolated Linux native fixture build/run is defined by `Dockerfile.native`, `prepare-native-fixture.py`, `run-native.sh`; the operator-specific remote invocation is retained in `tmp/usage-native-run-remote.sh`. It uses container-root custody paths and an internal PG17.10 server with no exposed network. The initial source fixture pins Go1.27.1 while the module requires Go1.27.2; only its exact compiler guard is adapted. Source input packs must include tracked diffs and untracked files with hashes. Export contexts with Python `tarfile` filtering macOS `._*` sidecars: Go's embedded migration runner otherwise treats AppleDouble metadata as SQL. Preserve failed attempt logs and containers until evidence is collected.

Remote attempts04,05, and06 passed the actual Go→private native HTTP→TS journal→consumer-control HTTP proof. Attempts05 and06 use the restored retained-custody native baseline and the final Gateway runtime bytes (separately checked equal across 17 source files). Attempt06 additionally verifies the actual aborted third call remains consumed with unknown tokens. Local `tmp/usage-e2e-receipt.json` records exact hashes and limitations.

Final controlled joined run: **3/3 passed**, 2026-10-21 20:56:56 Europe/Kyiv, 3.99 seconds. Native replay deliberately starts with only prepared/not-dispatched RR lifecycle records, proving later authoritative native spend remains visible. Aborted native effect-unknown counts as an attempt while its tokens remain unknown. The final database and newly introduced cluster roles were removed. Real provider/GitHub installed-pin acceptance remains separate.

Follow-up on 2026-10-21 21:19:54 Europe/Kyiv: the same three joined tests passed again in **8.22 seconds** against current RR/Action source after provider/model attribution fixes. Native06 captured bytes were reused; no new remote fixture build or live workflow dispatch occurred. This run does not exercise the artifact SDK upload timeout branch or the additional TrustedActionSession provider-profile grant path. The newer Gateway journal selected-request-model patch needs its own installed-source qualification; current RR correctly keeps unobserved actual provider/model unknown.

Follow-up2026-10-21 23:04 Europe/Kyiv:3/3 joined tests passed in8.30 seconds against Action `eb763ba12c432e522f3119071a52623f200e3429`. The retained native capture report period now follows original captured event timestamps, preserving source bytes as wall time advances. This is controlled transport/API/PostgreSQL evidence; live provider and installed immutable-pin acceptance remain separate.

Follow-up on 2026-10-22: all three joined tests passed in 12.51 seconds against RR `526a5a00` and public Action `381e32cda151a6e6d72fa1b27fa37dc7c1c47f71`, after integrating the active PR description and context-tools features from main `cd604c9a`. A dedicated disposable PG17.5 cluster applied the current full migrations, including `000138_pr_description` and `000139_review_context_tools`. The retained native capture was replayed unchanged. This is controlled transport/API/database evidence; installed production and live provider acceptance remain separate.
