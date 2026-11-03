# Foundation ownership refactor

Date: 2026-11-04 (Europe/Kiev)
Baseline: `f952f7c8e72277c8367a20769db0b8d7bc548219`
Status: investigation complete enough to select the bounded slices below;
independent plan review precedes implementation. This file is the delivery plan
and evidence journal, not a claim of completed qualification or deployment.

## Objective

Remove technical debt that is already spreading business decisions across
hosts or obscuring whether an operation actually committed. Preserve the
modular monolith, accepted protocols, tenant boundaries, durable state and
in-flight recovery. Use the existing feature owners, application ports and
composition conventions. No new framework, service, feature flag or generalized
workflow engine is needed.

The owner permits a substantial refactor, including a 15–25k-line diff when
justified. Changed-line volume is not an acceptance criterion. A smaller
complete boundary is preferable to unrelated changes added to reach a number.

## Research and counterevidence

Three independent GPT-6 Astra / ultra researchers inspected backend ownership,
web/application boundaries and publication/worker reliability. The root review
checks the proposed failures against active callers and existing defenses.
Read `AGENTS.md`, the maintained Engineering Quality Standard, ADR-005, the
feature-first structure, frontend architecture and previous reliability plan.

| Candidate                                       | Evidence at baseline                                                                                                                                                                                                                                                                           | Disposition                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Workflow provisioning outcome authority         | `WorkflowProvisioningRepositoryPort` terminal writes return `void`; Prisma correctly refuses stale attempts, but both provisioning use cases still return the external PR and append success audit. The existing PostgreSQL older/newer attempt scenario explicitly returns the superseded PR. | Select A. Preserve the existing fences and make their result authoritative in the application.                     |
| Publication lifecycle policy drift              | API `createProductionPublicationLifecyclePort` reads the persisted runtime capability, requires activated per-thread history and binds the publication's own resolution operation. Worker `createProductionPublicationDecisions` independently builds a resolver without those checks.         | Select B. One feature-owned lifecycle policy, with host adapters for other context facts.                          |
| Mixed feature public roots                      | Workflow provisioning, review configuration and audit-log roots export application contracts together with Prisma/Octokit/other outer adapters. Core imports cannot express the intended boundary, and consumer examples perpetuate it.                                                        | Select C. Explicit composition entrypoints and complete consumer migration for these three owners.                 |
| GitLab inventory atomicity                      | Current main already has a transaction, advisory lock, generation and ownership fences plus PostgreSQL concurrency coverage.                                                                                                                                                                   | Already addressed; do not redo it.                                                                                 |
| Worker phase and per-item publication isolation | Current main already contains the previous reliability fixes.                                                                                                                                                                                                                                  | Already addressed; retain existing behavior/tests.                                                                 |
| Organization ruleset lifecycle                  | Its own terminal writes lack attempt fencing; the post-success audit failure is caught as provisioning failure, and request/outbox writes are separate.                                                                                                                                        | Record separately. Its lifecycle/schema/outbox repair is a distinct owner and is not silently added to this batch. |
| Codex rotating monolith                         | Domain file mixes credential parsing, rendering, crypto and execution helpers. Open PR #809 is changing provider quota behavior on this path.                                                                                                                                                  | Do not split the monolith or alter quota semantics in this batch.                                                  |

The publication discrepancy is not evidence of an existing duplicate thread
mutation exploit: `recordPendingResolution` already locks and fences the final
transactional transition. That defense must stay intact. The selected problem
is divergent admission behavior and missing history checks at one live caller.

## Scope and coordination

Selected owners: `workflow-provisioning`, `review-publishing/v2`, and the public
entrypoints of `review-config` and `audit-log`. Host changes are restricted to
their real API, worker, web and operator consumers. Tests, package exports,
required boundary checks and the deployment registry change with those owners.

Open memory PR #806 and quota PR #809 retain their scope and ownership. Recheck
current main and open PR diffs before integration. Preserve concurrent changes;
do not reset another checkout, overwrite an unrelated branch or use force push.
The earlier #796–#798 work is already integrated and is not counted as delivery.

Excluded: production rollout, database schema redesign, organization ruleset
lifecycle changes, new provider features, UI redesign, new transport protocols,
memory behavior, custody/release authority, generic repositories, scheduler
changes, full compiler migration and all-repository barrel rewriting.

## A. Authoritative workflow attempt outcomes

### Guarantees and ownership

1. A terminal adapter operation reports whether its exact scoped attempt and
   revision committed. A refused comparison-and-swap is an explicit superseded
   outcome, never a successful write hidden behind `Promise<void>`.
2. The application must not return a superseded external PR as its committed
   setup result, append a success audit for it or mark the current attempt failed.
3. A real external PR may already exist when authority is lost. Preserve that
   fact in the bounded outcome/recovery contract; do not delete it, retry the
   external effect automatically or claim it never happened.
4. Separate external-effect/persistence failure handling from the post-commit
   audit path. An audit failure after a committed PR must not be relabeled as
   a failed provisioning attempt or produce a misleading failure audit.
5. Existing authorization, repository selection, archived/installation checks,
   per-repository lease, attempt identity, revision, workspace and installation
   predicates remain authoritative. No timestamp replaces an existing fence.

### Implementation boundary

- Change the existing provisioning port and its Prisma/in-memory/test adapters;
  migrate every implementation and caller in the same delivery.
- Apply the same outcome contract to ordinary and Hosted Pool provisioning.
  Keep their provider-specific workflow construction separate where semantics
  differ. Share the repeated settlement/error policy only when both consumers
  have the same obligations.
- Keep application workflow policy in the owning feature. Extract a coherent
  setup operation from the Next action only where it gives that policy one
  owner and a meaningful typed contract. Do not merely move the entire action
  file to another directory or create a service-locator dependency bag.
- Next action wrappers continue to own trusted user/access context, form
  adaptation, cache revalidation and redirects. Infrastructure owns Prisma,
  GitHub transport and runtime-source reads. Existing public client result and
  error mapping must distinguish retryable/transient failure from supersession.
- Decide the exact discriminated outcome/error and audit semantics during plan
  review, then record them below before changing production code.

### Necessary edge cases and verification

- Current attempt commits and returns its exact PR once.
- Older attempt finishes after lease expiry and a newer attempt's success:
  newer state remains authoritative; older call cannot claim current success.
- Failure of an obsolete attempt cannot overwrite or audit failure for the
  current attempt. Cross-workspace/installation/revision rejection remains.
- External success followed by persistence uncertainty remains uncertainty;
  do not retry as if the external operation were known not to have happened.
- Post-commit audit failure preserves the persisted successful state and does
  not enter external provisioning failure cleanup.
- Exercise real PostgreSQL plus the existing HTTP GitHub fixture and real
  Octokit adapter. Strengthen the existing concurrency regression rather than
  creating a second test harness. Cover both provisioning variants at their
  application boundaries and existing web/operator result mapping.

## B. One publication lifecycle policy

### Guarantees and ownership

1. API admission and worker pre-effect admission use one feature-owned current
   lifecycle resolver. They agree on missing, invalid, unavailable, changed and
   current outcomes for the same persisted inputs.
2. Read the persisted runtime capability through a narrow fact contract. A
   current feature flag or host environment is not the historical authority.
3. When the persisted capability requires resolution history, missing ports,
   unavailable reads or missing activation cuts fail closed. Legacy snapshots
   without that capability retain their accepted existing behavior.
4. Bind an own-resolution exception only to the exact persisted publication,
   permit and canonical operation identity. Do not accept a merely similar
   thread or untrusted operation identifier.
5. Preserve `ResolveCurrentPublicationLifecycle` thread/head/watermark checks
   and `recordPendingResolution`'s transactional lock, pending-operation and
   confirmed-history defenses. The shared resolver does not replace them.

### Implementation boundary

- Put orchestration in `review-publishing/v2/application` using narrow
  publication-owned fact ports/DTOs. Keep Prisma, runtime snapshot parsing,
  crypto implementation and other contexts' concrete repositories outside it.
- Host or composition adapters translate the execution/run-control snapshot
  into those facts; reuse existing public contracts and hash ports.
- Wire both production API and worker to the same resolver and existing
  resolution-history/publication stores. Do not import one app from another.
- Keep genuinely different host capability sets, context-reuse policy,
  transport authorization and scheduling at their existing owners.
- No new table, migration, lease, retry engine or global registry.

### Necessary edge cases and verification

- A foreign pending resolution, prior confirmation or unavailable history after
  request creation must not become `Current` only because the worker consumes it.
- Canonical recovery of this publication's own operation remains possible;
  wrong permit/attempt/operation is rejected.
- Missing execution, malformed projection, missing authorization, changed
  current generation/head and read failures retain honest distinct outcomes.
- Verify capability present/absent and activation present/absent explicitly.
- Add a discriminating regression against the original worker wiring, then
  run both production host suites and the existing publication/history tests.
- Reuse the real API/worker/PostgreSQL E2E fixture with local signed identities
  and synthetic GitHub. Extend only the needed thread-history fixture if
  required. Label this evidence accurately; it is not a live GitHub/provider
  or production rollout qualification.

## C. Explicit application and composition imports

### Contract

- The three selected package roots expose their domain/application contracts.
  Prisma, Octokit, HTTP/interface and composition adapters move to the established
  `/composition` export shape. Migrate callers and mocks; do not keep compatibility
  re-exports that continue teaching the old dependency direction.
- Preserve `types`, source/default and emitted `production` conditions for each
  new export. Build output must contain the corresponding entrypoint.
- Feature core consumers cannot import these composition entrypoints. Outer
  hosts/adapters may use them. Update the existing boundary mechanism with
  rejecting fixtures for the selected contract, not a general new graph engine.
- Do not claim transitive purity of all legacy dependencies: review-providers
  and codex-oauth-rotating still have independently owned mixed paths. This
  slice removes direct adapter exports and prevents their return in its scope.
- If an infrastructure helper contains business policy needed by the selected
  workflow operation, move only that proven policy to its existing feature
  owner; do not hide it behind a newly named composition barrel.

### Verification

Inventory all imports, re-exports, namespace/dynamic imports and mocks before
removal. Check source and production export resolution, package/API/worker/web
typechecks, the affected behavior suites, and negative boundary fixtures.
No new library dependency or unused adapter interface is justified by this move.

## Delivery, reviews and acceptance

1. Commit and immediately push this plan; open a draft PR.
2. Independently cross-review A/B/C, resolve material design comments, publish
   the concrete contracts and only then implement each lane.
3. Reproduce the selected behavioral defects with existing focused/PG fixtures.
   Keep the before/after result bound to the baseline and changed source.
4. Commit and push each coherent implementation checkpoint immediately. Use
   author `777genius <iliyazelenkog@gmail.com>` and preserve contributor identity.
5. Run focused checks during implementation; run integrated E2E, relevant strict
   native TypeScript 7.0.2 projects, formatting/lint and required architecture/
   CI gates for the final source. Keep existing pinned compiler/API adoption
   explicit; do not silently change the toolchain to make a gate green.
6. Run multiple independent critics over behavior/concurrency, ownership and
   integration. Fix substantiated findings; repeat rounds until no confirmed
   material findings remain. A green test count does not replace source review.
7. Update this plan, PR description and deployment task registry with exact
   commits, commands, observed results and limitations. Inspect remote checks
   through the GitHub plugin while continuing useful local qualification.
8. A queued check is pending, not passing. Do not bypass branch protection,
   weaken checks or claim merge/deploy completion from local evidence. Complete
   the reviewable implementation and all available verification independently
   of runner queue latency. Production rollout remains a separate action.

## Evidence journal

- Baseline fetched and isolated working branch created.
- Main/open PRs read through the GitHub plugin. Required protected checks are
  `Quality Gates` and `Dedicated Release Authority PG17 contract`.
- Installed the exact frozen workspace dependencies with pnpm 11.28.7 and the
  existing isolated native TypeScript 7.0.2 compiler; no dependency changes.
- Implementation, regression results and critic dispositions: pending.
