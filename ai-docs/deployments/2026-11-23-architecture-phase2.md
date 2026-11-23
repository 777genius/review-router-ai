# ReviewRouter architecture phase II: deployment

- Task ID: `2026-11-23-architecture-phase2`
- Goal: the approved ReviewRouter version uses feature-owned workflow admission, setup authority and context-gateway configuration with a narrow conflict-runtime published contract, plus a qualified Foundation/Get Modular toolchain; existing review/setup behavior and recovery remain unchanged.
- Affected targets: Web, API, worker, source-bound conflict-runtime bundled Action; ordinary private application image/release only after the generated Action artifact has been independently qualified.
- Implementation: [Draft PR #977](https://github.com/777genius/review-router-ai/pull/977); [bounded plan](../plans/2026-11-23-reviewrouter-architecture-phase2.md).
- Implementation reference: draft source branch `refactor/architecture-boundaries-phase2-20261123`; provenance is **not** evidence of a merged commit or installed image. The final shipping SHA is unknown.
- Dependencies: reconcile prior [#810](https://github.com/777genius/review-router-ai/pull/810) and [#914](https://github.com/777genius/review-router-ai/pull/914) (already merged), active Native/Gateway provider [#959](https://github.com/777genius/review-router-ai/pull/959), compiler stack #967–#975 and qualified modular consumer #976; preserve their actual owners. No unrelated upstream merge is authorized.
- Last updated: 2026-11-23.

## Environment status

| Target                                     | Status    | Actual version / image | Last verified (UTC) | Evidence / next action                                                                                                                     |
| ------------------------------------------ | --------- | ---------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Staging Web/API/worker                     | `pending` | Not verified           | Not verified        | No rollout requested; select an exact qualified main SHA in a future approved coherent batch                                               |
| Production Web/API/worker                  | `pending` | Not verified           | Not verified        | Reconcile existing fleet and unfinished deployments; do not deploy a Draft PR                                                              |
| Public/source-bound conflict Action bundle | `pending` | Not verified           | Not verified        | Rebuild exact `action-dist/conflict-runtime.cjs`, prove byte parity and original workflow ownership before any separate Action publication |

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
Browser, offline-Prisma isolation, complete toolchain/build and final-head CI
remain separate prerequisites. These are local qualification results; no
environment deployment or public Action publication was performed.

| Time (UTC)             | Environment | Operator                 | Actual version / image              | Observed result                                                                                                                                                                                           | Next step                                                                                                              |
| ---------------------- | ----------- | ------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 2026-11-23 (pre-merge) | Source only | ChatGPT GitHub connector | Draft PR #977; no installed version | Scoped source changes and negative tests pushed; isolated exact-source Node22 smoke had 226 direct assertions PASS. This is **not** the pinned TS7 product build, PostgreSQL/browser E2E or deploy proof. | Finish qualified bundle, exact npm/lockfile, full product E2E and protected merge before any separate approved rollout |
