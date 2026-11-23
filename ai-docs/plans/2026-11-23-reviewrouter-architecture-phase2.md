# ReviewRouter architecture hardening — Phase II

Date: 2026-11-23 (Europe/Chisinau)
Baseline main: 06aae0faf17687e52b9d0be63717c8ccc16d1458
Working branch: refactor/architecture-boundaries-phase2-20261123
Status: IN PROGRESS — no E2E, merge, or deployment claim
Authority: AGENTS.md, Engineering Quality Standard, Feature Module Standard adopted profiles, current security/runtime protocols.

## Objective and counting rule

Complete a substantial, bounded, behavior-preserving architecture remediation: remove proven core-to-infrastructure leaks, move application decisions to their feature owners, enforce the new boundaries, and qualify currently published Engineering Foundation/Get Modular dependencies. Preserve the feature-first modular monolith.

Planning envelope: 12,000–22,000 uniquely touched lines of relevant source, tests and executable policy over the completed coherent batch, with a preference for at least 10k if genuine ownership work warrants it. This is NOT a quota to manufacture churn. Record separately relocated production source, semantic edits, tests, policy/CI and manifests/lockfile; relocation counted once. Never pad volume with broad formatting, generated files, duplicated adapters, empty facades or unrelated rewrites. If safe work is smaller, report its true size.

## Baseline / overlap inventory

- Previous architectural refactor PR #810 already merged: workflow CAS outcomes; API/worker publication policy; application/composition exports for workflow provisioning, review-config, audit log and provider setup; provider setup storage and finite publication ownership. Do not repeat.
- Previous provider integration PR #914 already merged. Do not redo its contracts.
- Open PR #959 changes 172 files: provider setup UI, account controls, Gateway/native provider integration, review-action-v2-production-composition.ts and architecture/foundation/provider-seams.yaml. These exact paths and provider policies are EXCLUDED from parallel edits. Check its file list before integration; reconcile rather than overwrite.
- Open PRs #967, #969, #971–#975 change TypeScript 7 compiler routing. This batch does NOT change their compiler scripts or transplant their work. Open #976 fixes current GM 0.7 Foundation consumer qualification; integrate/reconcile rather than independently reimplement or overwrite scripts/provider-foundation.
- Other open API/worker reliability PRs #960, #962, #965, #970 require file-by-file overlap checks. No force-push to their branches.
- Current ReviewRouter pins: engineering-foundation 2.1.0, Get Modular Core/Assembly 0.7.0, Conformance 0.5.0, Resources 0.2.1. As of this review, upstream GitHub source manifests report Foundation 3.1.0, Core/Assembly 0.8.0, Conformance 0.5.2, Resources 0.2.2, FMS 0.3.2. Upstream source versions are NOT evidence the same release exists at npm stable dist-tags or is compatible. Verify registry artifacts, peer contracts and minimum-release-age before changing pins.

## Lane A: Action Control Plane contract ownership (first implementation)

Evidence: packages/features/conflict-runtime/src/domain/conflict-runtime.ts imports four domain-only values via the broad @reviewrouter/features-action-control-plane root. That root exports Prisma, JOSE and HTTP adapters. The facade hides the intended published-language boundary.

Implement exactly one narrow public domain-contract subpath from Action Control Plane exporting only the four consumed contract values (schema, type, advisory context, summary limit); migrate the one core consumer. Do not remove legacy root exports until an independently inventoried consumer migration. Update the existing Action v2 exact export-map checker to accept only this named new path; enforce that this new facade cannot import/re-export infrastructure, composition, interface, transport DTO, other features or framework modules. Do not weaken exact existing OIDC, v2/contract-source or protocol checks. Add a rejecting negative fixture for the contract facade; verify source and production conditional exports and the emitted file. No schema, tokens, auth or protocol behavior changes.

Acceptance: reference identity and exact schema behavior unchanged; action control plane/conflict runtime focused tests and architecture checker pass; negative mutant fails; emitted production subpath exists and resolves.

## Lane B: dashboard setup workflow application ownership

Evidence: apps/web/app/dashboard/actions.ts ~3,979 lines. createSetupPullRequestMutation ~488 lines and confirmSetupPullRequestMergedMutation ~996 lines mix trusted host request, admission, provider/workflow policy, persistence, GitHub transport and outcome mapping.

Before extraction, inventory all real consumers and existing feature ports and snapshot observable behavior in focused tests: authorization before effects, repository/workspace identity, revision, rate limit, entitlements, current attempt/lease, audit, external PR, cache invalidation/redirect and lost-response recovery. Move only coherent application policy to existing workflow-provisioning/provider-setup owner. Keep FormData/Next session, response/redirect and cache in the host; Prisma and Octokit in infrastructure adapters. Reuse settled CAS outcomes from #810 rather than inventing new retry, generic repository, service locator, new feature flag or framework. Extract and commit one use case before the next; preserve effect ordering and exact idempotence.

Acceptance: real PostgreSQL + existing GitHub in-memory/replay fixture for stale older attempt, successful new attempt, external PR already created but DB settlement uncertain, postcommit audit failure, cross-workspace denial and duplicated delivery. Browser/Next wrapper smoke verifies same form and redirect. Never claim success from a skipped fixture.

## Lane C: Action-v2 context attestation composition cleanup

Evidence: API context-attestation ~3,854 lines, execution-evidence ~3,101 and investigation ~3,089 contain mixed orchestration and host adapters. Avoid separate production-composition because #959 is changing it.

Select one contiguous, high-risk decision in apps/api/src/review-action-v2-context-attestation-composition.ts and move it into its existing owner review-context-attestation (or the actually owning published feature). First add characterization tests. Domain receives immutable facts; application receives only owned typed ports. Keep HTTP mapping, token decoding/signature verification, database transactions and authorized session in the adapter/host. Do not change exact permit, tenant, generation, sequence, expiration, own-operation or history fences. No new service, registry, runtime assembly, schema migration or implicit retries. Follow with another coherent operation only if overlap and regression evidence remain safe.

Acceptance: negative tests for missing/current/obsolete head, replay, permit/context mismatch, failed history, activation absence, concurrency and provider failure; selected API + worker + PostgreSQL suite with synthetic signed GitHub; no behavioral drift.

## Lane D: executable narrow boundaries and FMS/GM integration

Adopt executable rules only for selected contexts actually touched by A–C: action-control-plane, conflict-runtime, workflow-provisioning, review-context-attestation/review-executions as relevant. Domain/application cannot reach infrastructure/composition/HTTP/Prisma/Next/Fastify/JOSE or GM assembly. Host adapters use explicit exported composition paths. Use existing Foundation/FMS checker and current import parser instead of second graph engine. Test value and type imports, re-export, import types, literal dynamic imports, source and production condition. Provide rejecting fixtures. Do not claim whole-workspace FMS conformance from bounded adoption. Fixed private helpers use static imports/factories; Get Modular graph nodes only for independently assembled capabilities.

## Lane E: exact compatible version upgrades (required before merge)

1. Read upstream release notes/peer contracts for Foundation 2.1→3.1 and Get Modular Core/Assembly 0.7→0.8 (plus Conformance 0.5.2 and Resources 0.2.2), FMS version currently adopted, npm manifest/dist-tags and package integrity.
2. First coordinate with PR #976 and retain its historical 0.2 consumer evidence byte-for-byte. Make the current-version consumer fixture/receipt qualify actual installed version without fake artifact identity.
3. Use an atomic exact-pin upgrade commit with real pnpm 11-generated frozen pnpm-lock.yaml; no fabricated lock integrity entries or unbounded ranges. Explicitly maintain security overrides and release age exceptions only where reviewed.
4. Preserve Foundation bounded v1 adoption unless a newer closed-workspace topology can be proved compatible. No silent capability switch to v2/v3, no disabling negative tests. Avoid editing provider-seams.yaml until #959 integration.
5. Run frozen install, foundation:check, foundation:assert-dev-only, foundation:assert-registry, foundation:qualify, foundation:qualify-memory/statistics, modular:qualify, FMS checks, native TypeScript 7 typechecks and rejecting mutants. If compatible packages/registry/Node/pnpm cannot be obtained, DO NOT commit unqualified pin changes. Record a precise compatibility/availability no-go and handle the version upgrade as a separate dependency PR; do not falsely mark it complete.

## Steps and commit order

P0. DONE research: current baseline, source manifestations and overlapping open/merged PRs inspected.

P1. Push this plan and open a Draft PR immediately. Critique it in four passes before full extraction and record repairs below.

P2. Make a small, provable Lane A contract-ownership commit, including source/production export paths and negative boundary contract. Push immediately; focused local checks as available. Do not combine dependency upgrades.

P3. Characterize selected dashboard workflows with existing fixtures; extract the first coherent use case, update hosts and tests and push. Repeat second only after reviewing the first.

P4. Characterize and extract one Action-v2 context-attestation application decision; push independently with tests and no provider-related overlap.

P5. Coordinate #976; qualify exact version upgrades with genuine registry artifacts, regenerate frozen lockfile and push atomic dependency update after compatibility proofs.

P6. Execute focused source and emitted checks, strict TS 7, existing architecture:check and negative tests, lint/format, PostgreSQL/Next browser scenarios and the required affected real E2E. Track actual pass/failure/skips, test selection and HEAD; do not mistake static review for execution.

P7. Review pass 1: SOLID, real owner and import/ABI. Pass 2: security, auth order, effect ordering, CAS/lease, provider custody and transaction recovery. Pass 3: tests/oracles, rejection mutants, false positives and integration/CI. Fix all critical/high findings and rerun affected gates. Counter-review final diff, inspect relevant PR threads.

P8. Only at the end, inspect exact-HEAD CI once, resolve actual failures, ensure required jobs and E2E success on that HEAD (queued/skipped != PASS), verify no unmerged overlapping changes, make PR ready and squash-merge. Verify merged main. Do not disable protections or treat a draft as merged/deployed. No production deployment requested.

## Four pre-implementation critique passes

1. Duplication/parallel ownership: #810 and #914 are merged; #959, #967–#976 have active owners. **Repair:** file overlap exclusions, narrow phase boundaries, no reimplementation or force updates.
2. Architecture and overengineering: risk of creating many graph nodes and duplicated injection layers. **Repair:** use existing feature ports and static factories, narrow only published boundaries; no new generic framework.
3. Behavioral security: migration can change authorization, durable settlement, credentials, repeat delivery and replay. **Repair:** characterize first; fail-closed behavior, preserve authoritative fences and exact order of effects; no DB schema changes.
4. Evidence/churn: 10k-line volume and passing checks can be misleading. **Repair:** count relocations separately; negative mutants, production ABI, real PostgreSQL/browser E2E; real exit status, exact HEAD, no skipped/queued pass claims.

## Current evidence, limits and definition of done

- Upstream versions above verified from repository package manifests; published npm artifacts not yet qualified.
- Existing #810 main and #914 main integrations confirmed. Open #976/#959/file-level overlaps inventoried.
- Current GitHub connector can write code, but the current execution container cannot resolve github.com and has no gh/pnpm/Node 26 repository checkout. **Until an actual checkout is available, local or E2E tests cannot truthfully be claimed PASS.**
- Completion requires (1) coherent feature-owned policy, (2) guarded source/production public ABI, (3) verified compatible exact dependency pins/frozen lock if available, (4) measured substantive diff without padding, (5) focused + integration + affected end-to-end evidence on the exact final SHA, (6) resolved critical/high review findings, (7) final review and merge protection, (8) merged-main verification. Draft PR or documentation commit alone is NOT completion.

## Executed checkpoint P2 (2026-11-23): source-level proof, not E2E

Commits pushed as they were prepared:
- d3af7256: plan + opened draft #977.
- a609ff34: new narrow Action Control Plane conflict-runtime subpath, explicit package conditions, architecture guard and rejecting fixtures.
- 02e9ae6b: move the 72-line schema/constant owner out of the eager domain aggregate; the facade now re-exports only that pure owner.
- 74306562: format narrow checker and fixtures.
- 8e5049a9: runtime identity/strict parsing regression tests.

Read-only comparison against main verifies that the extracted source block is byte-identical after trimming; the original public builder function body is byte-identical; the consuming domain resolves only the narrow public subpath, and its facade imports exclusively the new domain owner. Conditional package exports target real source and emitted production paths. PR file-path intersection is empty with current #959, #976, #970. These are STATIC SOURCE proofs, not build/test assertions.

### Important P3 characterization discovery before any large source move

- apps/web/app/dashboard/actions-codex-rotating-contract.test.ts reads actions.ts verbatim and slices exact function markers, including provisionPendingRepositoryOwnedWorkflow, createSetupPullRequestMutation, confirmSetupPullRequestMergedMutation and resolveCodexRotatingProvisioningActionRef. These source-bound checks assert active vs candidate SHA selection, attestation ordering and the unique writer-policy callsites. A blind extraction would silently break the oracle or require weakening it. Do not simply delete these markers; first replace them with equivalent executable owner/host contract tests and retain the original tested semantics.
- Existing test owners: actions-workflow-provisioning-recovery.test.ts (1,437 lines), actions-hosted-workflow-recovery.test.ts (2,303 lines), actions-codex-rotating-contract.test.ts (263 lines). They cover authorization-before-side-effects, unknown/head-changed/wrong-base, hosted/repository-owned activation, writer version and workflow attestation. Reuse these instead of a fresh E2E framework. Any source-marker fixture migration must be reviewed as a semantic test change, not automatic textual replacement.
- No production actions.ts source edited yet. The target for P3 remains one coherent use case only once the exact external effect order and PostgreSQL/browser oracles can actually be executed.
- Exact dependency upgrade not committed: npm registry and a real pnpm install/frozen lockfile are unavailable in the current execution container. Upstream source versions are noted but are not npm artifact evidence. Do not present this as an updated dependency set or a successful local test.

### P2 review observations

Round 1 (public API): a pure facade pointing at the legacy aggregate still loaded unnecessary feature roots — repaired by moving the owned schema itself.
Round 2 (source identity): extracted block and unchanged builder compared exactly against baseline; no new parser/serializer behavior introduced.
Round 3 (boundary tests): malformed/extra contract exports and direct eager-root consumer imports are rejected by fixtures; a runtime identity/strict parse regression test has been added, but execution is still pending.
Round 4 (integration scope): no overlapping paths with current #959, #976, #970; do not claim cross-version runtime compatibility or finished CI solely from this static inspection.


## P3 first bounded policy extraction (2026-11-23)

Commit `bafdf7b2165454439df685044d651d489b33d024` immediately pushed. `workflow-provisioning` now owns the pure managed workflow option admission predicate in `src/domain/managed-workflow-setup-options.ts`; the existing `createSetupPullRequestMutation` invokes it at the same position **after** host-qualified runtime/entitlement/rate-limit reads and **before** provisioning. No authorization, source selection, GitHub request, database transaction, audit or external side effect moved. Existing transport and workflow style types reused. Root feature export is additive, and there is no new package, container, config flag or framework.

Regression suite added as `packages/features/workflow-provisioning/src/tests/managed-workflow-setup-options.test.ts` (12 named positive/negative cases covering Gateway provider API, rotating, hosted and CI-secret modes). A separate in-memory V8 comparison of the legacy expression vs extracted expression exhaustively checked all 40 transport/style/discussion/runtime-available combinations: zero mismatches. **This is expression-level simulation only, NOT a Vitest, TypeScript, local integration, or browser E2E PASS.** Open #959 and #976 changed-path intersection remained empty after the commit. Avoid moving the entire `actions.ts` function before source-marker tests are replaced by equivalent executables.

### Remaining gates (not performed)

- Affected Vitest tests, real TypeScript build, production condition import and standalone emitted contract ABI checks.
- `architecture:check` and rejected-mutant qualification.
- Exact GitHub commit CI and applicable PostgreSQL/Next browser E2E.
- Safe, real registry-verified Foundation 3.1.0 and Get Modular 0.8.0 upgrade, integrity and real pnpm-generated frozen lockfile.
- Substantive high-risk ownership extraction of the much larger workflow/admission slice, final reviews, merge. Current Git diff is far below the intended 12–22k lines; no completion or merge claim.

The user explicitly prefers pushing every cohesive change immediately and postponing broad CI checks until the end of coding instead of repeatedly polling queued runners. Preserve this order, but do not drop required final E2E or branch protections.

## Direct-session continuation, source review and remaining E2E (2026-11-23)

Owner explicitly disabled the scheduled automation: implement and push directly; do not treat automation status as evidence. The automation was disabled through the task API. Keep Draft #977 until exact-HEAD checks and artifact qualification pass.

Additional pushed slices:
- `c4bc58ee`: feature-owned classifySetupPullRequestHead() preserving null/missing/changed/historical merged observation; 12 focused cases, with the API still responsible for independently verifying the actual installed workflow and current database attempt.
- `e85abb7c`: feature-owned isCurrentWorkflowSetupAuthority() preserving all current-repository/attempt/head/branch/URL/workflow predicates; all existing reads and final CAS stay in Next/Prisma; 17 focused cases including transfer and revision mismatch.
- `4ce5ddab` + `438205e9`: type-only conflict-runtime consumers no longer import the mixed Action root except two explicitly allowed legacy runtime adapters; additional source boundary negatives; fix the checker to await its async scan.
- `ecf0f92a`: format focused recovery fixtures.
- `16bae4ad` + `7eeb482d`: context-gateway lifetime/key configuration admission moved to existing feature domain with invalid-key/TTL matrix, API wrapper and error identifier unchanged.

### Source-level review pass A: semantics

The dashboard head and workflow-attempt predicates are exact logical extractions: host still obtains identity and session authority first, reads Prisma in the same order, checks the same fields before activation, and uses its existing atomic final settlement. The owner returns Boolean/classification only. There are no new externally visible errors, provider policies, database queries, migrations, feature flags or retry paths in these helpers. The context gateway receives the same numeric/key-size checks and error code before effects. This is a source review, **not** recorded passing test execution.

### Source-level review pass B: authorization, secrets, concurrency

- Do not move the dashboard actor/entitlements before repository resolution; do not bypass the installation/tenant selection or `assertCurrentBinding()`.
- The workflow authority helper is a precondition, **not** the final authority; Prisma compare-and-swap remains mandatory. Its observed current attempt is passed by the trusted database adapter, never directly by the browser.
- Do not convert historical PR observation into proof of installed workflow. Continue independently checking exact content/SHA, source and actor before the final write.
- Do not move context gateway crypto/session secret or lease/receipt checks into a general shared package; no provider secret or token logged in tests.
- Negative cases require unexpected workspace, installation transfer, stale attempt/revision, changed PR head/base, artifact mismatch and expired/invalid context configuration to fail closed.

### Source-level review pass C: artifact, source/build and strict version migration

**New blocking discovery:** `action-dist/conflict-runtime.cjs` is a committed generated bundle (~530 kB at the baseline) with byte-level source parity checked by `scripts/build-conflict-runtime.ts --check` and CI `pnpm action:artifact:check:smoke`. Lane A changes runtime source imports, so this bundle is **not yet qualified and must be rebuilt** with exactly the pinned esbuild/Node/pnpm toolchain. Do NOT claim that the unchanged artifact matches, and never manually edit its minified contents. Required procedure:
1. Build a clean checkout of the full branch with CI pinned Node 26.11.1, pnpm 11.28.7 and approved frozen dependencies.
2. Run `pnpm action:build` twice; verify deterministic identical `action-dist/conflict-runtime.cjs` bytes, unchanged and approved `action-dist/index.cjs` when appropriate, and absence of machine paths or secrets.
3. Commit source-generated bundle bytes and immediately push. Run `pnpm action:artifact:check` and the existing bundle's preflight-fail-closed tests, then all affected E2E.
4. Do not attempt to fabricate the bundle via source string changes, a manual base64 paste, ad hoc GitHub write-token CI, or a stale artifact from another HEAD.

**Runtime constraint:** this session has read/write GitHub connector access but the terminal lacks a checkout of this repository, Node 26/pnpm 11, npm/GitHub DNS, and its installed 1,000+ workspace dependencies. The installed system Node is 22.16.0. Consequently no local `pnpm`, test, emitted bundle or PostgreSQL E2E verdict can be asserted. GitHub CI triggered by pushes was QUEUED when inspected; skipped auxiliary workflows are explicitly not PASS. Do not turn draft into ready or merge based solely on these source reviews.

### Final exact-HEAD acceptance sequence once a qualified checkout is accessible

Required in order, using the final actual source and lockfile:
1. `pnpm install --frozen-lockfile` under the exact pinned Node/pnpm and no untrusted script changes.
2. `pnpm --filter @reviewrouter/features-action-control-plane build`, `pnpm --filter @reviewrouter/features-conflict-runtime typecheck`, `pnpm --filter @reviewrouter/features-workflow-provisioning typecheck`, `pnpm --filter @reviewrouter/features-review-context-attestation typecheck` and actual API/Web/worker typecheck.
3. `pnpm architecture:check` including negative boundary mutants, applicable feature/GM/Foundation qualifications, and exact public exports in production mode.
4. `pnpm vitest run scripts/check-architecture-boundaries.test.ts packages/features/action-control-plane/src/tests/conflict-runtime-contract.test.ts packages/features/workflow-provisioning/src/tests/managed-workflow-setup-options.test.ts packages/features/workflow-provisioning/src/tests/setup-pull-request-head.test.ts packages/features/workflow-provisioning/src/tests/workflow-setup-authority.test.ts packages/features/review-context-attestation/src/tests/gateway-session-configuration.test.ts`.
5. `pnpm vitest run apps/web/app/dashboard/actions-workflow-provisioning-recovery.test.ts apps/web/app/dashboard/actions-hosted-workflow-recovery.test.ts apps/web/app/dashboard/actions-codex-rotating-contract.test.ts scripts/build-conflict-runtime.test.ts`. These exercise the actual Next actions, GitHub fixtures, stale attempts and checked-in CLI bundle.
6. Real PostgreSQL/HTTP/browser and selected Review Action v2 context gateway E2E under existing controlled fixtures. No synthetic fixture may be described as live GitHub/provider qualification.
7. Full affected `pnpm build`, `pnpm lint`, `pnpm format:check`, artifact checks, protocol checks and any required dependency/CodeQL/security checks. Count *only* real test passes, no skips/queues.
8. Final independent review, fix all high/critical findings, confirm no #959/#976 overlap, merge latest main, run final exact-HEAD CI/required gates, squash-merge and verify merged-main. Never override release/deployment policy. Merge is not deployment.

### Dependency upgrade still pending, not silently omitted

Upstream GitHub manifests show Foundation 3.1.0 and Get Modular Core/Assembly 0.8.0, Conformance 0.5.2, Resources 0.2.2. Public jsDelivr additionally lists Foundation 3.1.0, but neither that nor GitHub source proves the exact npm tarball integrity and full compatibility. Current root manifest + lockfile remain pinned to old versions. The upgraded set needs a genuine pnpm-generated frozen lockfile and the precise Foundation bounded policy and Get Modular current-consumer contract qualification. The existing #976 consumer fixture must be preserved/updated in coordination; do not bypass it or disable the failing tests.

Plan state at this checkpoint: **P1 complete, P2 code pushed but E2E and bundle build incomplete, P3 selected pure recovery policies pushed but full real-host acceptance incomplete, P4 one bounded context gateway policy pushed but real API E2E incomplete, P5–P8 pending.**
