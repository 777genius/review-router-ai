# Joined provider usage verification

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
