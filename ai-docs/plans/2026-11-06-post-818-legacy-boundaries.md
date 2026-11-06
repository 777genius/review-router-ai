# Post-#818 ReviewRouter legacy-boundary refactor: plan and review ledger

Date: 2026-11-06
Baseline: `main` at `bd47f4af5986234bd67f9082e418993881cce92b` (#818 merged).
State: **plan-reviewed, implementation not yet accepted**. Revalidate HEAD before each code packet.
Budget: **10,000–20,000 meaningful changed lines across the full effort**, not a quota for new code. Count additions + deletions of application code, adapters, characterization tests and architecture guards separately; do not count formatting churn, generated bundles, lockfiles or this document as implementation. **Safety outranks the numeric budget.**

## 1. Mandate and constraints

Reduce proven accumulated legacy, wrong ownership and needless duplication in ReviewRouter. Preserve active behavior, real user data, stable public import paths, GitHub App and Account Gateway workflow ABI, memory and review protocols, response/status error shapes, provider-secret custody, OIDC/lease/fencing/transaction semantics, audit and side-effect idempotency. Do not remove code without evidence that it is unused or superseded and an explicit replacement and regression test. Where uncertain, keep it.

Clean Architecture dependency direction is `domain <- application -> ports <- adapters`, with product composition at host edges; SOLID means one authority for each invariant, not one tiny class per function. DDD applies to real bounded contexts (review execution, review evidence, workflow provisioning), not to every script. DRY applies when behavior and ownership genuinely match; different security decisions should not be force-merged. Do not introduce flags, new service layers, a generic repository/DI framework, framework switch, database schema migration, release, production deploy, customer repository smoke, or unrelated UI redesign.

**Get Modular:** `@get-modular/core` is an inert declaration / deterministic composition toolkit; its Host retains runtime lifecycle and authorization. The repository already has multiple packages and a boundary checker. This refactor will **make those existing module boundaries explicit first**, with typed ports and negative architecture fixtures. Do **not** migrate live API/worker/dashboard composition onto Get Modular or introduce a second lifecycle authority merely to satisfy a technology preference. A later opt-in adapter can be evaluated separately after an executable consumer and conformance case prove benefit. No dependency is added here.

## 2. Actual repository evidence; avoid previously merged work

- #815 already extracted Action HTTP transport, bounded failover, process custody, secret boundaries, and Codex workflow ownership. #817 fixed non-idempotent GitHub comment uncertainty. **Do not duplicate.**
- #818 merged a transaction-scoped Review Safety query adapter and bounded investigation persistence/pruning extraction. Its plan covers a conditional dashboard C but did not mandate a full rewrite. **Do not redo** the Prisma Proxy or investigation prune.
- Earlier #747/#798/#810 already changed outbox/identity, dashboard read owners and workflow provisioning. Never rename owners merely to increase changed-line counts.
- Open #806 owns human-evidence memory observation selection; open #441/#473/#474/#475 own deployment/PG17/Hetzner/custody. Avoid those surfaces and their migration/deployment authority.
- Tree at this baseline contains ~5,425 entries and 2,171 non-test TS/JS sources (~20.8 MB). Size is only a prioritization signal.
- `packages/features/review-executions/src/infrastructure/prisma/prisma-review-execution-store.ts` is 2,803 LOC and implements **four** ports: query, command, pruner and invocation-flight query. The same file contains aggregate restoration (`loadSnapshot`), persistence update, domain-to-Prisma mappers, lease fencing/lock and retention SQL. The existing `prisma-review-execution-mappers.ts` is a natural owner for pure persistence mappings. **Keep the one transaction owner and the four stable public contracts.**
- `apps/api/src/review-action-v2-execution-evidence-composition.ts` is 3,290 LOC; mixes route wiring, handlers, protocol/body parse, lease authority, domain mapping and result/status presentation. `review-action-v2-context-attestation-composition.ts` is 3,941 LOC; mixes gateway operations and canonical v4 replay encoding/verification. These are candidates for cohesive private extraction, **not** permission to re-design protocols or reuse secrets.
- `apps/web/app/dashboard/actions.ts` is 4,007 LOC. Setup-PR creation (~1195–1712) and merge-confirmation (~1713–2702) use authorization, external GitHub mutations and audit. #810 already extracted provisioning owners; the remaining composition may be genuinely host-specific. C is conditional, not required to hit a LOC target.
- `scripts/check-architecture-boundaries.mjs` is an existing enforcement owner. Prefer adding bounded checks to it rather than creating a new lint framework. Existing feature tests include `prisma-review-execution-store-real.test.ts`, `prisma-review-execution-store-retry.test.ts`, `review-execution-store-contract-memory.test.ts`, API composition tests, and dashboard workflow recovery tests.

## 3. Scope and architecture choice

| Option                                                                          | Boundaries /10 | Reliability potential /10 | Complexity (10=hard) |                                                    Estimated new code | Decision                                     |
| ------------------------------------------------------------------------------- | -------------: | ------------------------: | -------------------: | --------------------------------------------------------------------: | -------------------------------------------- |
| A. Bounded extraction into existing feature/adapters + typed, tested host edges |              9 |                         9 |                    5 | 300–900 production helper/guard LOC plus moved code and focused tests | **Choose**                                   |
| B. Full Get Modular migration of API, worker and dashboard                      |              8 |         5 until qualified |                   10 |         >8,000 extra infrastructure/adapter LOC before behavior proof | **Reject: scope and lifecycle risk**         |
| C. Split every large file into many forwarding classes                          |              5 |                         5 |                    8 |                                                       >2,000 glue LOC | **Reject: cosmetic and DRY regression**      |
| D. Delete suspected legacy directly                                             |              3 |                         2 |                    6 |                                  potentially negative but unqualified | **Reject until call-site and runtime proof** |

The adopted target is three connected but independently revertible **vertical slices**, with one architecture ratchet. Each extraction must have an owner, no new cycles, a smaller responsibility-edit radius, tests that fail on a meaningful regression, and preserved public API. No generic "service manager" or hidden compat framework.

## 4. Phase 0 — baseline, characterization and collision discipline

1. Re-read latest `main`, active PRs and touched paths before implementation. Branch only from exact merged `bd47f4af...` or rebase carefully if `main` advanced; do not overwrite other writers or force-push over unexpected work. Every commit is pushed immediately to the **same Draft PR**.
2. Inventory all public exports and call-sites for each selected port, existing SQL ordering, ORM transaction ownership, review request/response examples, and tests. Define a read-only before/after contract ledger. In particular: precise lease acquire/renew/release and replay statuses; current revision/scope; persisted JSON/null handling; cap on aggregate collections; idempotent finalization.
3. Characterize before moving any security- or persistence-sensitive behavior: concrete red/green unit or PostgreSQL regression, preserving errors, failure atomicity and exact SQL control flow.
4. Use existing Node 26 / pnpm 11 and repository scripts/AGENTS. Avoid local scripts that bypass source stamp, protocol gates or runner policy. Keep generated Action bundles unchanged unless an Action source truly changes.
5. Compile a per-packet diff ledger and stop if new imports are cyclic, boundaries get wider, golden behavior changes or E2E shows stale/unsafe publication.

## 5. Phase A — review execution persistence cohesion (priority P0; target ~3–5k changed lines)

**Ownership:** `packages/features/review-executions/src/infrastructure/prisma/`.

A1. Move only pure domain-to-Prisma record encoders and stable normalized JSON encoding out of `prisma-review-execution-store.ts` into the **existing** `prisma-review-execution-mappers.ts` (or one cohesive companion when circular imports would otherwise arise). Preserve every mapper's exact property list, null/undefined semantics, Prisma.InputJsonObject cast, timestamp and enum encoding. Do not move any query/lock or transaction ownership while doing A1. Check mapping parity against the current source and existing memory-vs-real contract tests.

A2. Extract focused **private** aggregate read/hydration functions into `prisma-review-execution-snapshot.ts` only if dependencies are narrow: `loadSnapshot`, `loadExecution`, `loadActiveLeases`, `loadLease`, `loadAttachmentTarget`, `assertBoundedAggregateCollection`. Keep the same `Prisma.TransactionClient` supplied by the call site. No new root-client calls, no new transactions, no altered query order or bounds. Reject the extraction if it requires imports back from the main store, a dependency bag or duplicated predicates. Use one typed common helper if necessary, not a public repository abstraction.

A3. Consider a distinct internal retention/lease persistence helper only after real PG tests prove SQL lock sequence and fencing. The current class **stays** the sole public query/command/pruner/flight adapter and owns retry boundaries. Retain optimistic version checks, tombstones, execution idempotency, outbox identity and row-lock order. Do not move or redesign `pruneRetainedHistory` just to increase LOC.

A4. Add focused real-postgres tests for same-scope/wrong-scope, revocation during concurrency, duplicate lease identity, stale transition, append/finalize/outbox replay, aggregate collection caps, cleanup partial failure, and mixed in-memory parity. The test should catch a different transaction, skipped lock, changed JSON encoding or unbounded load. Verify existing `prisma-review-execution-store-real.test.ts` and `...-retry.test.ts` as acceptance.

**No-go:** changing Prisma schema, transaction isolation or count guards; adding a second persistence authority; moving true domain decisions into SQL mappers; silently deleting `observeActiveInvocationFlightByLane` whose legacy callers may remain.

## 6. Phase B — API Review Action V2 composition boundaries (priority P1; target ~4–7k changed lines)

**Ownership:** existing `apps/api/src` host and the existing review-executions/context feature packages, without new public protocol.

B1. In `review-action-v2-execution-evidence-composition.ts`, isolate the **pure** protocol-to-domain result/status projection and validation owner only when its dependency closure is acyclic. Keep current route entrypoints and handler construction at the API host. Do not change runtime authorization checks, bearer/lease/snapshot validation order, finalization/publication writes or provider execution.

B2. In `review-action-v2-context-attestation-composition.ts`, carefully isolate canonical replay-material parsing/normalization and v4 operation-key calculations only after characterization fixtures for legacy and v4 manifest variants. Avoid duplicating `canonicalContextAttestationManifest` or global cryptographic policy; maintain exact bytes/digests, size limits and errors. Keep gateway session/lease/authority and network operations with their current owner. If helper import closure is excessive or error constructors are tightly bound to the host, **defer** rather than force a new abstraction.

B3. Targeted tests must cover canonical round trip, wrong event order, duplicate receipt, unsupported tool, query redaction, cursor and undefined sentinel, malformed JSON, invalid length/shape, failed replay with no external effects, stale lease, missing/revoked authorization, different repository/revision, unknown provider effect. Keep source stamp/contract verifier, generated protocol and Action pin unchanged.

**No-go:** redefining protocol enums, changing work-slot or reviewer semantics, extending limits, rewriting model dispatch/OCR/Hindsight, reconnecting Gateway, or adding a shared "all review operations" controller.

## 7. Phase C — optional dashboard workflow mutation ownership (priority P2; target ~1–3k changed lines)

Recheck `actions.ts` against merged #810 and existing web/server workflow owners. **Only** if a concrete duplicated mutation/decision remains, move that operation behind a narrowly named existing server-side owner; preserve exported Next.js actions and actor/workspace access checks before any GitHub write, audit, rate limit, precise workflow SHA, repository installation identity and return/redirect behavior. Otherwise skip C and document why. Avoid touching provider-account or memory code and open #806.

Minimum contract cases if C proceeds: unauthorized actor (zero GitHub calls), repository removed/archived/transferred, changed default branch, stale setup PR head, unknown GitHub outcome, replay/restore, audit event failure and mixed managed/Gateway flow. Source-text-only tests must not replace behavior tests.

## 8. Phase D — enforce and qualify (cross-cutting; ~1–2k changed lines)

- Add bounded negative + positive fixtures to the **existing** architecture checker for specific new private module boundaries: domain/application cannot import Prisma/Fastify/Next; feature infrastructure cannot import its API/dashboard composition roots; internal read/mapping helpers cannot import the main store. No code search count mistaken for proof of correctness. Keep legacy exclusions honest.
- Focused gates after every packet: pinned format, TypeScript, lint and named tests. Then `pnpm architecture:check`, `pnpm protocol:check`, full `pnpm typecheck`, `pnpm test`, build, source/bundle parity when relevant, `pnpm review-v2:e2e`, `pnpm review-investigation:e2e`, self-hosted E2E and DB contract/migration suites **through existing CI runners**. For API composition, include paired Gateway/OpenCodeReview tests. Do not claim private PG rehearsal if CI policy skips it.
- Review each packet (security/authority, architecture/DDD, reliability/concurrency, test/E2E) and record findings and fixes with exact commit/SHA. Request/use available external CodeRabbit review; verify its actual comments rather than claiming it ran. Repeat review when substantive code changes, and fix P1/P2 findings before Ready/merge.
- Keep draft while work is incomplete. No merge, tag, public Action publish, production release or deployment from this refactor by default. Add deployment registry task **once implementation begins**; record staging/production pending and exact source/verification. Deployment requires separately authorized rollout and current registry reconciliation.

## 9. Acceptance and stop conditions

**Complete** only when all chosen extractions improve measured ownership (not just filenames), public imports and source-generated contracts remain compatible, changed behavior has red/green evidence, focused tests and full applicable exact-HEAD CI including real DB and self-hosted E2E are green, relevant review findings are fixed, diff is formatted/owned, no parallel PR overlap, and the PR/rollout registry accurately state what remains uninstalled.

**Stop/replan** on: changed external protocol, missing owner, non-idempotent effects, unexplained performance/lock regression, root Prisma escape, new DI/lifecycle framework, compromised data/privacy safeguards, test-only fixture masking real behavior, need to delete code without dynamic or static reachability proof, or >20k meaningful lines. If validated improvements end below 10k, report actual size and do **not** create artificial churn.

### Line budget and evidence ledger

| Phase                             |  Estimated meaningful changed lines | Real qualification                       |
| --------------------------------- | ----------------------------------: | ---------------------------------------- |
| A: review execution persistence   |                         3,000–5,000 | unit + real PG + concurrent CAS/lease    |
| B: Review Action v2 host helpers  |                         4,000–7,000 | protocol/canonical fixtures + paired E2E |
| C: workflow mutation if warranted |                         1,000–3,000 | authorization + existing UI recovery     |
| D: architecture/tests/docs        |                         1,000–2,000 | negative fixtures + full CI              |
| **Projected**                     | **9,000–17,000** (rough, not quota) | actual diff determines scope             |

Move-only changes are counted as file-diff additions/deletions but separately reported. Format-only and generated code are not counted toward the meaningful target. We will reassess after A; do not reach for riskier areas merely to increase this table.

## 10. Adversarial plan review — three rounds, distinct critical lenses

These are **source-based adversarial review passes by the current implementation assistant**, not independent xhigh model executions. Separate external AI reviews are only counted after GitHub shows actual review evidence.

### Round 1 — two critics: safety/authority and runtime reliability

**Security critic (fail if):** A vague "split store" changes transaction ownership, lease SQL locks, authorization before outbound calls, crypto canonicalization or source/fencing checks. **Correction:** A keeps the public store and transactions; B is restricted to pure parsing/projections; C guards GitHub side effects with existing actor/repo checks. Explicit negative test targets added above.

**Reliability critic (fail if):** Tests only assert source strings, real PostgreSQL behavior is skipped, or replay duplicates external writes. **Correction:** real PG snapshot/lease/CAS, old/new contract fixture parity, exact-head CI jobs and explicit policy-skip reporting. No retry of uncertain external creates.

### Round 2 — two critics: Clean Architecture/DDD and anti-overengineering

**Architecture critic (fail if):** New mappers require an import back into the monolith, host imports enter domain, or Get Modular adoption becomes a second runtime manager. **Correction:** existing package owner, only inward dependencies, optional extractions rejected on cycles, no new framework. Anti-regression guards go into existing checker.

**Scope critic (fail if):** 10–20k number drives UI churn, renames or removal of legacy without provenance, or touched files overlap #806 / rollout PRs. **Correction:** meaningful line accounting; A+B can stand without C; no formatting/generator padding; main commit and active PR collision check first; uncertain legacy stays.

### Round 3 — two critics: verification/proof and release operations

**E2E critic (fail if):** A green lint run is called E2E, a skipped PG rehearsal is called a pass, or tests run against a stale commit. **Correction:** strict exact-HEAD acceptance; describe skipped/unavailable gates honestly; keep paired Gateway, live-disposable and self-hosted evidence distinct.

**Operations critic (fail if):** Source merge is called deployment or rollout activates migration/custody paths. **Correction:** add task registry once implementation code exists, staging and production `pending` until verified, no release/deploy, no schema changes or production-secret handling in this PR.

### Outcome after three rounds

Decision: **GO for A1 characterization and smallest mechanical mapping extraction; conditional A2, B and C behind their gates.** Open question requiring implementation evidence: whether reusing the existing Prisma mappers stays cycle-free and all persistence forms serialize identically. On failure, keep them local or use one cohesive private companion, never cast away safety types. All "critic" perspectives are internal until separately evidenced by an external review.

## 11. Live progress / review evidence

| Packet                  | Commit           | Checks                    | Review                                       | State       |
| ----------------------- | ---------------- | ------------------------- | -------------------------------------------- | ----------- |
| Baseline + plan         | Initial Draft PR | Repo/PR/source audit only | Three internal adversarial plan rounds above | Planned     |
| A1                      | Pending          | Pending                   | Pending                                      | Not started |
| A2/A3                   | Pending          | Pending                   | Pending                                      | Conditional |
| B1/B2                   | Pending          | Pending                   | Pending                                      | Conditional |
| C                       | Pending          | Pending                   | Pending                                      | Conditional |
| Full E2E + final review | Pending          | Pending                   | Pending                                      | Not claimed |

No success or autonomous external model run is implied by planning.
