# Architecture and reliability refactor

Date: 2026-10-30
Baseline: `26e9726242b0deadbf1cb7aafade12e645934523`
Status: investigation and implementation plan; draft PR, not deployment evidence.

## Goal

Reduce the most consequential sources of correctness and growth risk in the
existing modular monolith. Prioritize clear ownership of state, transactions,
leases, application contracts and trusted input. Clean Architecture, SOLID, DDD
and DRY are evaluated through observable behavior and dependency direction.

The current repository already has feature packages, inward-facing application
ports and selective architecture enforcement. This work extends that structure
where a concrete defect or expensive change boundary is demonstrated.

## Parallel investigation

Three independent GPT-6.1 Sol / xhigh agents investigate:

1. Review execution, worker lifecycle, outbox ownership and recovery.
2. Cross-context dependencies, authentication, persistence and workspace isolation.
3. Web/API contracts, application orchestration, validation and state ownership.

Each finding needs source evidence, a credible failure scenario, an explicit
owner, a bounded change and a test that can fail before the fix. A second agent
reviews complex plans before implementation and reviews integrated changes.

## Initial findings requiring implementation plans

### A. Outbox claim ownership during serial execution

Owner: `features-outbox`.

`processOutboxBatch` claims an entire batch and then runs handlers serially.
Only the currently executing handler receives heartbeats. A later claimed event
can expire while an earlier handler is running and can be taken over by another
worker before the first worker invokes its stale handler.

Plan review must resolve when claims are acquired and checked, preserve existing
fencing/recovery/handler-version rules, and establish a deterministic two-worker
regression. No exactly-once external-effect claim is implied by a database lease.

### B. Atomic external identity resolution

Owner: `features-auth` persistence adapter.

`PrismaUserRepository.upsertExternalIdentity` looks up an identity, changes a
User, then upserts the identity using separate commits. Concurrent first logins
can create a detached principal or fail against GitHub uniqueness. A failure
between writes can leave inconsistent state.

Plan review must preserve the established external identity owner and make
identity resolution return that persisted owner atomically. Cover concurrent
first login, repeat login, conflicting ownership and rollback at the adapter
boundary. Workspace creation remains with its existing application owner.

### C. Web/API and dependency-boundary audit

Investigation continues. Large files alone do not justify a rewrite. Select a
slice only after showing duplicated policy, insufficient boundary validation or
an observable state/authorization failure. Record rejected candidates to avoid
cosmetic fragmentation.

## Compatibility and coordination

Existing PRs are reviewed before selecting files. At this baseline, full-thread
memory/settings (#744), OCR delivery/setup (#745), Usage SQL (#746), and Skills
context navigation (#735) have active owners. This task avoids overlapping their
implementation. Existing persisted data, public protocols, in-flight work,
tenant checks and feature-specific lifecycle guarantees remain obligations.

No new service, dependency-injection framework, feature flag, generic repository,
package-manager change or broad toolchain migration is planned. Add a small port
or module only where the selected consumer and owner demonstrate its purpose.

## Delivery sequence

1. Publish this plan and open a draft PR.
2. For each selected complex slice, publish concrete invariants, failure cases,
   implementation boundaries and verification steps before changing code.
3. Implement independent slices in isolated worktrees; commit and publish each
   coherent change promptly.
4. Run risk-focused tests and applicable type, formatting, lint and architecture
   gates; inspect actual CI and distinguish inherited failures.
5. Have independent critics review behavior, ownership, compatibility and test
   adequacy; fix substantiated findings and repeat affected checks.
6. Update this plan with outcomes and remaining debt, and register the ordinary
   code rollout using the existing deployment registry.

The requested deliverable is reviewable draft PR work. Merge, release and
production deployment are not part of this request.

## Evidence journal

- Baseline and open PRs inspected on 2026-10-30.
- Maintained Engineering Quality Standard read through the selected GitHub
  connection; repository-specific adoption and pins remain authoritative.
- Initial A/B findings are source-backed hypotheses awaiting independent plan
  review and regression qualification.
