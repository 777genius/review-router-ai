# ReviewRouter architecture phase II: deployment

- Task ID: `2026-11-23-architecture-phase2`
- Goal: the approved ReviewRouter version uses feature-owned workflow admission, setup authority and context-gateway configuration with a narrow conflict-runtime published contract, plus a qualified Foundation/Get Modular toolchain; existing review/setup behavior and recovery remain unchanged.
- Affected targets: Web, API, worker, source-bound conflict-runtime bundled Action; ordinary private application image/release only after the generated Action artifact has been independently qualified.
- Implementation: [PR #977](https://github.com/777genius/review-router-ai/pull/977); [bounded plan](../plans/2026-11-23-reviewrouter-architecture-phase2.md).
- Implementation reference: draft source branch `refactor/architecture-boundaries-phase2-20261123`; provenance is **not** evidence of a merged commit or installed image. The final shipping SHA is unknown.
- Dependencies: reconcile prior [#810](https://github.com/777genius/review-router-ai/pull/810) and [#914](https://github.com/777genius/review-router-ai/pull/914) (already merged), active Native/Gateway provider [#959](https://github.com/777genius/review-router-ai/pull/959), compiler stack #967–#975 and qualified modular consumer #976; preserve their actual owners. No unrelated upstream merge is authorized.
- Last updated: 2026-11-25.

## Current E2E follow-through — 2026-11-25

**Incomplete; Draft retained.** Source `29e8386e` has a successful frozen install,
9/9 Statistics preload/heap regressions, and complete lint/qualification bound
to the independently matched recorded source and installed graph. The later
`fcf03b67` only adds CI preparation and documentation outside E2E inputs.
The latest full tooling and architecture attempts failed with SIGKILL; causes
remain unproved. Separate earlier passes retain their original scope.

Historical `6b6f1d0` evidence qualifies 62 backend cases and full tooling/
architecture. Its asset-restored UI failed 12/4 and Statistics failed before
browser launch, with 0 journeys/0 captures. Current production/paired/UI/Statistics
workloads have no new complete PASS: resource admission blocked the corrected
backend and the final browser window. Test assertions, timeouts, retries and
heap caps remain unchanged.

One later backend setup was aborted before tests after unintended runtime/
preload differences were found. They are corrected and independently reviewed,
but a causal runtime fix is not proved. Its original namespace shutdown/port
closure is unverified; owned cluster/logs are retained and credentials removed.
No new workload was started by the final blocked admission windows.

The [current E2E evidence](evidence/2026-11-25-priority-e2e-followthrough.json)
records actual counts, source bindings, controller exits, retained failures and
cleanup debt. The old [outage checkpoint](https://github.com/777genius/review-router-ai/blob/6b6f1d00bed23dc2dca87052783399c2d9738bbe/ai-docs/deployments/evidence/2026-11-25-priority-e2e-followthrough.json)
is retained by commit. Earlier sections below are source-bound checkpoints.
No complete 78/78, Statistics acceptance, merge, staging or production rollout
is established by this continuation. Keep the existing rollout requirements.

## Published native lint adoption checkpoint — 2026-11-25

Statistics heap protection `6378ee3f` and exact published Stack 0.3.1 adoption
`29e8386e` are available in PR #977. No application rollout is performed by
this checkpoint. Existing Foundation 3.1.0, FMS 0.3.2, Get Modular and native
TypeScript 7.0.2 pins are preserved.

The existing producer owner completed Release `45516866453`, attempt 2, and
verified publication/signature/provenance. Consumer inspection separately bound
the actual tarball SRI, full 339-file manifest and attestation subject to producer
source `fac03920`. Normal frozen installation and lifecycle pass after an exact
optional Bun build denial; the earlier rejection is retained.

Statistics regressions pass 9/9, original full tooling and lint-format strict
pass, complete lint qualification passes 47/47 plus 90/90 with the unchanged
20-rule oracle and 624-row ledger, and full guarded `pnpm lint` passes. The
first missing-island strict attempt and two child-completion qualification
failures remain failed records. Successful retries preserve original projects,
fixtures, assertions and timeouts. Six legacy-load blocks are expected negative
fixtures rejected before initialization. Independent review matches all 4,862
present source hashes to publication and records six unchanged sparse absences.

CI preparation now installs the existing locked Accounts harness in the three
jobs that compile or execute it. The original check commands, job conditions
and triggers are unchanged; semantic YAML comparison and formatting pass.

The full architecture command on `29e8386e` fails at its final metadata native
compiler with SIGKILL after the preceding boundary/Foundation/feature checks
pass. No signal cause or aggregate architecture PASS is asserted. The earlier
metadata-only recovery retains its separate `1357cdfc` source and scope.
Ordinary Ready CI, complete current browser/paired acceptance, merge and main
verification remain pending. Staging and production retain their existing
pending status; historical E2E reports and source-identity mapping are preserved.

See [the current evidence](evidence/2026-11-25-pr977-native-adoption.json) for
source bindings, complete receipts, retained failures and signature-verification
limits.


## Scoped review continuation — 2026-11-25

The owner has authorized additional scoped refactoring, repeated correctness
review and eventual merge of this PR. Application deployment remains outside
this request. The latest execution/evidence API extraction reduces its entrypoint
from 3,129 to 166 lines and moves existing responsibilities into eight API-owned
modules. Source change: nine files, +3,367/-2,998, net 369 lines. Independent
review preserves all 86 declarations, 11 exports and acyclic dependency wiring.

Actual qualification at original source `1169070c` includes 250/250 focused
tests, 157/157 architecture checker cases, 3/3 browser routing cases, original
API/tooling native strict projects, nine emitted modules/declarations and plain
production imports with no source fallback. Fresh production HTTP/PostgreSQL
E2E passes 17/17 with all 165 migration checksums and owned-resource cleanup.
The browser UI16 and paired45 receipts retain their earlier source bindings;
they are not relabeled as new API-source execution.

Source-identity normalization is complete at `fd1089e6`, with the exact same
tree as qualified `1169070c`; the original history is retained under
`recovery/rr977-original-1169070c-20261125`. The independent audit verifies all
49 mapped objects, 57 unchanged originals, exact raw messages and ordered
parents. Original bot-generated artifact provenance remains recorded.

Whole-PR gates remain incomplete. Full lint fails on the unavailable native
Stack adapter; upstream Stack 0.3.1 is still unpublished at the recorded
observation. The full architecture command and its isolated metadata strict
diagnostic fail because the native compiler receives SIGKILL, without a
TypeScript diagnostic. Preserve these failures and obtain final ordinary gates
on the eventual installed dependency graph. No merge, deployment or new runtime
configuration is established by this checkpoint.

See the [scoped review receipt](evidence/2026-11-25-pr977-scoped-review.json),
[original-to-normalized source mapping](evidence/2026-11-25-pr977-source-identity.json)
and [maintained plan](../plans/2026-11-23-reviewrouter-architecture-phase2.md#final-review-and-delivery--2026-11-25).

## Priority refactoring checkpoint — 2026-11-24

Source `a5ed3e93072002efc04b1581a991d0b798065b46` additionally separates execution
lifecycle decisions, Context Attestation API host responsibilities and typed
architectural policies. The original public contracts, cryptographic preimages,
authorization order, lease/CAS fences and recovery semantics are preserved.
The new source batch is 25 files, +7,461/-6,827; the PR exceeds 25,000 changed
lines without expanding dependencies or adding product features.

Local qualification passed 450 existing tests with zero skips, including 45
real PostgreSQL 17.12 execution/recovery cases and 28 Fastify transport cases.
The original native TS7 execution/API/tooling projects passed. The maintained
full database catalog and historical provider fixture have 165/82 successful
migrations with exact source checksums. The API build passed 46/46 tasks;
separate guarded native emission and production-condition loading verified
all nine context modules/declarations with no TS-source fallback. Two independent
source reviews found no new confirmed defect. See the
[source-bound summary](evidence/2026-11-24-priority-refactor.json).
The complete architecture gate passed on 694 domain/application files with
zero Foundation diagnostics, 23 Memory and six Statistics workspace cases,
and the retained History/account-metadata checks.

No runtime configuration, schema migration or data conversion belongs to this
new batch. An eventual approved application release includes the API and worker
code; the architecture checker affects development gates only. Use the existing
artifact, acceptance and rollback process below. The owner requested Draft
publication without waiting for CI. Whole-PR lint/Stack adoption, browser and
release gates remain pending; no deployment or merge is implied by this evidence.

## Environment status

| Target                                     | Status    | Actual version / image | Last verified (UTC) | Evidence / next action                                                                                     |
| ------------------------------------------ | --------- | ---------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Staging Web/API/worker                     | `pending` | Not verified           | Not verified        | No rollout requested; select an exact qualified main SHA in a future approved coherent batch               |
| Production Web/API/worker                  | `pending` | Not verified           | Not verified        | Reconcile existing fleet and unfinished deployments; do not deploy a Draft PR                              |
| Public/source-bound conflict Action bundle | `pending` | Not verified           | Not verified        | Two independent source builds match the committed bundle; no public Action channel promotion was requested |

`pending` records no completed qualification or deployment and does not assert absence of a deployed version. No environment rollout was attempted for this task.

## Applicability and prerequisites

1. Final reviewed code has no external protocol, API authentication, durable schema, database migration, new flag, provider behavior or intentional customer-visible change. The extraction must preserve the original authorization before I/O, exact head/revision/lease/installation CAS, provider credentials, historical recovery, replay and externally published workflow identities.
2. The exact source release must contain independently verified `action-dist/conflict-runtime.cjs`. Changing the published Action artifact is **not** permission to promote a public Action tag/channel or deploy the runtime by itself.
3. Verify really installed, integrity-checked, mutually compatible Foundation/Get Modular/FMS artifacts and both pnpm 11 frozen lockfiles. Maintain hard allowlists for any release-age exceptions and their rejecting tests. The historic Get Modular 0.2 receipt remains historical, not evidence for 0.8.
4. Complete targeted feature tests, existing dashboard provision/merge-recovery tests and real PostgreSQL CAS/concurrency fixture, action-runtime parity and E2E, API/worker publication/investigation as affected, browser setup and workflow confirmation, branch-protection and required exact-HEAD CI. Skip/queued/pending/cancelled are never PASS.
5. No Stage/Production action is authorized by this deployment task. Follow the existing release/activation runbook and owner approval for the next coherent bundle. Do not infer deployment from green CI or merge.

## Ordered rollout (only if a later authorized release selects this implementation)

1. Reconcile the actually running Web/API/worker/Action versions and all unfinished tasks for the exact approved destination source. Confirm current provider, Gateway, authorization, producer and Action channels without copying credentials or mutating owner state. No new database migration is associated with the planned code-only change.
2. Qualify the exact built private runtime/image and independently regenerated Action source/commit identity. Retain previous signed image and Action channel; do not silently replace a public workflow pin. If any separately governed public Action promotion is required, use its own approval and release authority.
3. Deploy Web/API/worker only through the maintained coherent-batch release path with existing backup, retention, readiness, channel and rollback safeguards. Do not introduce activation flags, extra schedulers, schema/backfill or new API transport.
4. Verify a real scoped repository setup/merge/confirm path and an actual review execution under its installed source, including historical HEAD mismatch, stale attempt, proper App-authored publication, and no duplicate side effects. Record actual deployed image/source/channel, timestamps, runner, durable evidence.
5. Mark each applicable environment `deployed` only after installed-state readback and relevant smoke/E2E. A failed partial rollout must be recorded without changing unrelated deployments.

## Retry, partial completion, and rollback

- Retrying a held workflow or review after an ambiguous external effect requires reconciling the exact persisted attempt, external PR, revision and idempotency authority first. Never automatically recreate a PR or publication because a response was lost.
- Preserve runtime/Action source coupling, previously signed image, current protected channel and existing DB state. Use the [release procedure](../operations/07-environments-and-release-management.md) for controlled rollback; do not run schema rollback (none belongs to this slice).
- An incomplete source qualifier, rate/quota/runner starvation, native/Gateway dependency, or review finding keeps that lane pending. Do not relabel queued/skipped jobs as green or launch an unrelated production deployment.

## Related links

- [PR #977](https://github.com/777genius/review-router-ai/pull/977), [architecture plan](../plans/2026-11-23-reviewrouter-architecture-phase2.md), [agent instructions](../../AGENTS.md).
- [Source-bound Action build](../../scripts/build-conflict-runtime.ts), [architecture checker](../../scripts/check-architecture-boundaries.mjs), [release process](../operations/07-environments-and-release-management.md), [quality gates](../operations/03-quality-gates.md).
- [Foundation/Get Modular qualification branch](https://github.com/777genius/review-router-ai/tree/refactor/phase2-dependencies-qualification-20261123) is an isolated in-progress development branch, **not** an approved app release or merged dependency update.

## Execution log

Local qualification on exact clean source `e3a2e9db87f052df68c21278f5dc96d7676e8aeb`
completed 732/732 functional tests with zero skips under Node 26.11.1,
TypeScript 7.0.2 and PostgreSQL 17.12. The maintained Prisma deploy created
165 successful migration-ledger records. Two source-generated builds matched
both committed Action bundles. See the
[local E2E receipt](evidence/2026-11-23-architecture-phase2-local-e2e.json).
The full source-bound workspace typecheck and architecture gates also passed.
On exact clean `e5279c73`, the complete modular qualification passed 25/25,
and packed Foundation qualification passed its strict consumer and seven actual
workspace boundary cases. The compiled API and worker passed the maintained
runtime smoke on a new PostgreSQL 17.12 database after all 165 Prisma migrations.
Both whole-build attempts failed at the Web native preflight with SIGKILL before
Next started; neither is production Web or browser evidence. See the
[runtime and tooling receipt](evidence/2026-11-23-architecture-phase2-runtime-tooling.json).
Skills qualification on exact clean `a8925fe7` passed 139 module/PG and five
API cases, including pinned paired Action HTTP transport, the real nested
frozen toolchain and a fresh 165-entry Prisma migration ledger; see the
[Skills receipt](evidence/2026-11-23-architecture-phase2-skills.json).
The subsequent native AST policy correction passed 135/135 affected tests,
40/40 CI routing tests, both original strict projects and the full architecture
gate with all 4,800 tracked inputs unchanged; see the
[native AST receipt](evidence/2026-11-23-architecture-phase2-native-ast.json).
The native lint qualifier and complete Unified OCR receipt checks are now
integrated into ordinary gates. The original combined strict projects, all
16 rejecting/positive receipt-validator tests and the full guarded format check
pass; exact-source native formatter/proof tests pass 47/47. Published Stack
artifact/SRI and final frozen lint qualification are still pending. The
[acceptance gate receipt](evidence/2026-11-23-architecture-phase2-acceptance-gates.json)
keeps validator evidence separate from actual browser/paired execution.
The complete paired lifecycle on exact `6013a91a` / Action `1112a0f1` subsequently
passed 25/25 with zero skips, all seven real OCR routes, PostgreSQL 17.12 and
165 Prisma migration-ledger entries. Its
[receipt](evidence/2026-11-23-architecture-phase2-paired-lifecycle.json) identifies
the historical local evidence lost in the executor reset and does not claim a
successful source OCR rebuild or browser run.
The ordinary [Statistics browser run](https://github.com/777genius/review-router-ai/actions/runs/45255482669)
passed frozen installation, required offline Prisma generation, migrations and
Web native typecheck; all 18 journey records and 21 screenshots completed.
Its aggregate result remains **failed** because Next-generated metadata cleanup
rejected the additional `root-params.d.ts` import. The
[recovered CI receipt](evidence/2026-11-23-architecture-phase2-statistics-browser.json)
and [bounded cleanup repair](evidence/2026-11-23-architecture-phase2-native-next.json)
keep original failure, actual writer controls, unit tests and pending corrected
browser execution separate.
The restored ordinary frozen graph subsequently passed the complete maintained
`pnpm build`: 56/56 tasks, zero cached tasks, 588 emitted-file rewrites and all
production Next phases, in 157.430 seconds. The 4,815 captured source inputs stayed
unchanged, and all 176 guarded Node processes avoided legacy initialization.
The actual production `BUILD_ID` is `AA-TcjEF_ASr0li-DgkYK`.
The complete `pnpm web:smoke` then passed all 12 pages and two redirects in
4.342 seconds after the reviewed localized hostname/readiness-timeout repair.
All original assertions remain; the owned server and process group stopped.
The original strict tooling project, 13 cleanup cases, three routing cases and
40 unchanged CI cases pass on the recorded v3 routing inputs. The subsequent v4
extension and published graph still need their combined root check.
The complete Action artifact check also passed again,
with its native strict project, source bundle comparisons and required binary
archive/manifest; all 4,816 source inputs stayed unchanged.

The completed [Self-hosted E2E job](https://github.com/777genius/review-router-ai/actions/runs/45255482350/job/138022980855)
provides independent actual filtered Docker production build, network-isolated
Prisma and 17+2 database E2E evidence. Its real checkout `6aeb2203` has the same tree
as `6013`; it is not the final candidate. The bootstrap ran 36 passed controls and
one optional skipped control. Product PostgreSQL 18, separate native Memory PG17,
partial Memory qualification and synthetic Action identity remain explicit in
the [scoped receipt](evidence/2026-11-23-architecture-phase2-native-next.json).

Published frozen native-lint qualification, complete corrected browser execution
and final-head CI remain prerequisites. These are source-bound qualification
results; no environment deployment or public Action publication was performed.

| Time (UTC)             | Environment | Operator                 | Actual version / image              | Observed result                                                                                                                                                                                           | Next step                                                                                                              |
| ---------------------- | ----------- | ------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 2026-11-23 (pre-merge) | Source only | ChatGPT GitHub connector | Draft PR #977; no installed version | Scoped source changes and negative tests pushed; isolated exact-source Node22 smoke had 226 direct assertions PASS. This is **not** the pinned TS7 product build, PostgreSQL/browser E2E or deploy proof. | Finish qualified bundle, exact npm/lockfile, full product E2E and protected merge before any separate approved rollout |
