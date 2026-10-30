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

## Reviewed implementation contract

Cross-review completed before implementation: the web critic reviewed outbox
ownership, the outbox critic reviewed identity resolution, and the boundary
critic reviewed settings audit. The following details supersede the initial
candidate descriptions.

### A. Outbox execution ownership

- Keep the existing atomic claim SQL, fencing terms, lane restrictions and
  handler-version selection.
- Claim at most one event immediately before execution. Read fresh time for
  every claim. The batch limit bounds claim attempts, including stale claims;
  this is a bounded drain, not a frozen snapshot or a global FIFO guarantee.
- A private application function owns claim validation, initial renewal,
  heartbeat lifetime, handler dispatch and fenced result transitions.
- Require the persisted claim owner and term. Refused or failed initial renewal
  suppresses dispatch, counts a stale claim once and leaves normal recovery
  responsible for that claim.
- Always stop the heartbeat and await an in-flight renewal before selecting
  the outcome, including a throwing handler. Preserve retry, permanent failure,
  exhausted attempts and reconciliation-preserving behavior.
- Preserve the existing adapter rule that expiration alone does not invalidate
  an otherwise current term. Active external effects retain their existing
  handler-owned idempotency/fencing obligations.

Verification: competing workers with a blocked first handler; takeover before
dispatch; initial-renewal failure; heartbeat cleanup on success/error; bounded
stale claims; unsupported/disabled handlers; recovery lanes; retry/dead-letter
and reconciliation regressions.

### B. External identity transaction

- Own the entire operation in the Prisma auth adapter, with a short
  ReadCommitted transaction and a parameterized transaction-scoped advisory
  lock on a namespaced, unambiguous provider/immutable-ID key.
- Canonicalize the GitHub numeric ID before locking. Do not use login or email
  as identity. Preserve the owner of an existing external identity.
- A missing GitHub identity may reuse a User by its exact immutable GitHub ID.
  Use an atomic User upsert because the existing installation-owner writer also
  creates these rows. The lock is cooperative; uniqueness remains authoritative.
- User snapshot and external identity snapshot commit or roll back together.
  Identity updates cannot reassign userId. Conflicting immutable ownership
  fails closed. Return the persisted identity's owner.
- Keep network operations and personal workspace creation outside this
  transaction. No historical orphan deletion/merge and no schema migration.

Verification: concurrent same-ID first logins for both providers; existing
installation-owner User followed by first login; exact numeric aliases;
profile rename; distinct IDs sharing login/email; conflicts; injected failure
after User creation/update; retry; durable rollback in disposable PostgreSQL.
Same-version correctness does not eliminate races in older web replicas;
rollout must complete before claiming the new writer is universal.

### C. Review settings write/audit consistency and GitLab write admission

- Existing review-config settings use cases own their saved/cleared audit action.
  Reuse saveNextVersions' existing transaction-scoped audit append.
- Web actions pass trusted actor/access metadata and repository identity.
  Derive provider/model/severity audit facts from the exact effective saved
  configuration inside the transaction; preserve authoritative version and
  providerSelected fields.
- If a small synchronous metadata projection is needed on the existing audit
  port, keep it typed, pure and scoped to this writer. Do not add an audit
  framework, asynchronous callback or another persistence transaction.
- Mark the automatic workspace document of a first repository settings save
  implicit, so only the requested target emits its audit event.
- Remove the two corresponding post-commit web audit writes.
- GitLab installation uses the existing workspace-admin mutation gate.
  Read-only discovery/command construction retains its existing gate.

Verification: one correctly targeted event on save/clear; implicit-head case;
exact saved metadata; denied/CAS writes have no event; injected audit failure
rolls back configuration and version in PostgreSQL; web forwarding; disabled
GitLab mutation refuses before installer or persistence work.

Shared review-config/action files also appear in #744/#745. Inspect their exact
diffs and preserve their unrelated behavior; reconcile against fresh main before
final integration. This is file-level coordination, not a claim that those PRs'
memory/OCR work is qualified by this task.

## Additional prioritized findings

These remain distinct candidates, not silently included promises:

1. Worker maintenance chains can let one feature's failed recovery prevent
   unrelated outbox/publication work. Any follow-up must preserve actual
   publication/progress dependencies and report named failures.
2. Publication due-work selection limits operations before filtering eligible
   attempts, allowing a long prefix of expired candidates to starve healthy
   work. Correct eligibility belongs before LIMIT in its owning adapter.
3. GitLab inventory installation persists multiple changes without one
   transaction/generation owner. It needs separate inventory race/rollback
   qualification, not a cosmetic extraction from a large server file.
4. Some older public feature barrels mix policy and adapters, and the legacy
   boundary checker recognizes only top-level domain/application paths.
   Extend enforcement only after inventorying real consumers and violations.

The codebase's existing ports, CAS, tenant guards and feature packages are useful
counterevidence. File size, class count or a preference for a pattern is not
enough to classify a defect.

## Second implementation batch: publication selection and boundary coverage

### D. Publication-owned due-work feed

The initial starvation finding is selected for implementation after independent
boundary review. The reviewed change moves the worker's persistence query into
the existing review-publishing/v2 feature; the host retains orchestration.

- Add one narrow application port and DTO for scan/defer. Export contracts from
  the existing /v2 entrypoint and the Prisma adapter from /v2/composition.
- The adapter uses one parameterized SQL join from operation to attempt to
  repository. Match repository ID, workspace ID and SCM repository identity.
  Apply supported provider, operation state/due time, live attempt state and
  retainUntil predicates before LIMIT.
- Preserve ordering: required descending, nextEligibleAt ascending,
  reconcileUntil ascending, operation ID ascending. Preserve the existing
  maximum of 1000 returned rows, zero-limit no-work behavior, and reject invalid
  noninteger/unbounded limits before accessing the database.
- Preserve the current operation and attempt state sets. Do not introduce
  selected/archived/installation, publicationNotAfter or reconcileUntil cutoff
  predicates; reconciliation remains possible under its existing contracts.
- Scan is discovery, not a claim or authorization. The executor continues to
  enforce current lifecycle, authority, capability and external-effect policy.
  Repository provider semantics remain unchanged.
- Move exact operation/attempt/retry-count/live-state defer CAS unchanged into
  the adapter. Map its plain github/gitlab provider at the worker boundary.
- No schema migration, oversampling, destructive pruning or new service.

Verification: an actual PostgreSQL fixture with more than four times the limit
of older ineligible rows followed by eligible work; exact order/limit; live and
terminal states; due/retention equality; stale/wrong-attempt/terminal CAS;
defensive scope/provider filtering. Use a separate loopback UUID database for a
minimal three-table fixture when testing historical invalid rows. Its omitted
composite FK is an explicitly limited defensive-query fixture, not evidence of
a production insertion exploit. Also execute the adapter against the fully
migrated disposable schema to verify real enum/query compatibility.

### E. Nested architecture coverage

The existing legacy checker recognizes only src/domain and src/application;
34 additional production TypeScript files and one domain test live below
subfeature prefixes. The inventory found no currently prohibited import there.

Change only classification: after src, the first architectural layer directory
determines whether the file is core. Domain/application remain core after v2
or account-limits prefixes; infrastructure/interface/composition/testing/tests
are outer barriers. For example, infrastructure/domain remains an adapter.
Preserve existing forbidden-import policy, extractor and all other ratchets.

Verification uses the existing checker harness: positive nested pure code and
adapter siblings, negative value/type/dynamic imports and re-exports, both v2
and account-limits, followed by the full repository check. This extends the
existing guard rather than claiming broader standard adoption or transitive
dependency certification.

## Published implementation checkpoints

- Outbox ownership: 8a9ffecd; 53 focused checks passed, and two discriminating
  regressions failed on the original implementation. Independent implementation
  review found no blocker. Follow-up dcc4f5c validates bounded-drain input;
  invalid limits access no repository and zero remains supported.
- Atomic identity resolution: 41bc69f2; 30 focused checks, including 12 real
  PostgreSQL cases in an isolated minimal-schema database. Installation/login
  races, canonical aliases, conflicting owners and create/update rollback are
  exercised. Independent implementation review found no blocker.
- Settings audit and GitLab admission: 70e6547b; 91 focused checks including six
  real PostgreSQL cases on the full migrated schema. Both rollback regressions
  failed against the original use cases. Feature typecheck, official native web
  typecheck, changed-code lint and architecture checks passed.

These are scoped implementation results, not a claim that every repository gate,
live OAuth/provider flow or deployment has completed. Integrated checks and the
second batch remain in progress.
