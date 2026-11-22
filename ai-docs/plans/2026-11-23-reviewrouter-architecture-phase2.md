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
