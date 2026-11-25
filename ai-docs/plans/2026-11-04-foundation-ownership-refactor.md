# Foundation ownership refactor

Date: 2026-11-04 (Europe/Kiev)
Baseline: `f952f7c8e72277c8367a20769db0b8d7bc548219`
Status: A–E implemented and independently reviewed, including the owner's
requested substantial continuation. F's required database and integration gates
are wired; their exact-head execution and merge state are recorded in PR #810.
The dated/source-bound evidence below distinguishes completed checks from the
checks still pending at each checkpoint. The reviewed contracts govern delivery.
This file is the delivery plan
and evidence journal, not a claim of completed qualification or deployment.

## Objective

Remove technical debt that is already spreading business decisions across
hosts or obscuring whether an operation actually committed. Preserve the
modular monolith, accepted protocols, tenant boundaries, durable state and
in-flight recovery. Use the existing feature owners, application ports and
composition conventions. No new framework, service, feature flag or generalized
workflow engine is needed.

The owner explicitly requested approximately 20k changed lines after reviewing
the initial 6,115-line diff. The continuation must deliver a substantial,
coherent ownership migration in that range. Count additions/deletions, relocated
production source, and relocated tests separately: a moved line is not newly
implemented behavior. Do not manufacture volume through formatting, duplicated
tests, compatibility wrappers, generated output or unrelated rewrites. D and E
address roughly 9.5k existing production lines and 7k existing test lines before
the necessary policy extraction, consumer migration and rejecting checks.

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

Selected owners: `workflow-provisioning`, `provider-setup`,
`review-publishing/v2`, and the public entrypoints of `review-config` and
`audit-log`. Host changes are restricted to their real API, worker, web,
operator and existing qualification consumers. Tests, package exports,
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
- Exercise real PostgreSQL plus the existing in-memory GitHub request fixture
  and real Octokit adapter. Strengthen the existing concurrency regression rather than
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

## D. Provider setup owns its persistence and lifecycle policy

### Evidence and boundary

The web host currently contains the concrete implementations of the existing
provider-setup ports: payload claim (2,314 lines), manifest issuance (1,249),
recovery (959), readiness (234), workflow namespace (200), mutation fence (109)
and migration source proof (60). Independent runtime tooling imports those web
files directly. This makes the host the accidental owner of setup persistence
and permits policy to continue growing in transaction adapters.

Move this exact cluster to `provider-setup/infrastructure/prisma` and expose it
through an explicit `/composition` entrypoint. Remove the old host modules and
migrate every real caller and mock, including live-E2E and migration tooling.
Move the existing memory adapter out of the application root. Preserve source,
types and production export conditions; add only the dependencies already used
by the moved adapters at their existing workspace pins. Do not add a cycle to
workflow provisioning merely to reuse a type available from its actual owner.

Extract these actual decisions into small provider-owned domain functions:

- Forced-recovery admission from provider, recovery and active-manifest facts,
  including the current conflict ordering and allocation versus replay choice.
- Claim replay eligibility and its existing bounded lifetime.
- Dispatch outcome choice: return, reject, retire expired, retire unknown, or
  confirm, after the same locked authoritative reads have completed.
- Coherent namespace/attempt state, bounded allocation and exact attestation
  equality where those rules currently live in persistence helpers.

The domain receives immutable fact values, never Prisma clients, environment
getters, provider SDKs or Node APIs. A transaction-bound admitted operation
remains an infrastructure capability; do not disguise its Prisma transaction as
an application port. Keep transaction statements in their current owner and
order. Split private adapter helpers only at a genuine responsibility boundary.
The installer descriptor becomes a provider-owned value; resolving its local
file, URL or configuration remains in the web adapter.

The payload-claim adapter currently implements three existing ports. Separate
current-workflow reading and workflow reattestation persistence into their own
Prisma adapter, using those existing contracts and the same locked reads and
database authority. Remove those methods from the claim/dispatch adapter and
migrate actual host composition directly. Shared witness, record-read and
paired-retirement helpers remain private infrastructure capabilities. Do not
retain delegating compatibility methods or introduce an additional port.

### Preserved guarantees

1. Preserve provider/manifest lock ordering, advisory retry behavior, transaction
   timeouts, database time, and exact writer/incarnation/repository identity fences.
2. Keep the pre-PUT effect inside the same repository identity transaction and
   keep signing before definite confirmation. Preserve every existing CAS count
   and role-authority database call; a pure policy result cannot replace them.
3. Preserve the bounded predispatch chain and never reuse a retired namespace.
   Ambiguous dispatch is not permission to create a new automatic external write.
4. Preserve recovery epochs, exact workflow attestation and current rejection
   ordering. An expired replay tombstone must commit before the error is surfaced.
5. Keep trusted web authorization, request adaptation, installer transport,
   exactly-once HTTPS ledger, signing composition and cache behavior in the host.
   Preserve existing feature admission configuration without adding flags.

### Qualification

Relocate focused adapter tests with their owner, retaining host integration and
actual PostgreSQL tests at their existing executable boundaries. Strengthen only
the extracted high-risk policy decisions. Run the existing manifest lock-order,
payload claim, recovery, readiness and namespace cases, the real manifest suite,
runtime migration PostgreSQL suite and locked-provider PG17 proof. Update the
secret-write boundary's exact audited ledger path and its rejecting fixtures;
never disable the gate to accept relocation. Extend the existing bounded
application/composition checker to provider-setup and prove rejecting imports.

## E. Publication owns finite execution and provider adapters

### Evidence and boundary

The worker currently owns a 2,538-line finite publication executor, 276 lines of
its consuming ports and a 1,554-line gateway combining signed capabilities,
credential sessions and GitHub transport. These implement publication policy
and adapters rather than worker scheduling. Move them to the existing
`review-publishing/v2` application and infrastructure; keep the worker's bounded
drain, polling, retry schedule, host clock and cross-context fact adapters.

The application executor coordinates one existing operation. Extract existing
command/identity construction and pure inventory, freshness and terminal-state
inspection into private publication modules. Inject the existing-style UTF-8
digest capability to remove Node crypto from application code. Do not create a
new scheduler, state machine framework, service container or recovery engine.

Separate infrastructure along its actual responsibilities: signed operation
capability codec, provider credential session routing, and GitHub App
credential/live-revision/publication transport. Expose concrete adapters only
from the established `/v2/composition` entrypoint. Move the payload DTO and its
consuming port into publication application so infrastructure cannot import the
worker. Keep canonical artifact/release/snapshot mapping and its query adapter
in the worker because they cross other feature owners. Preserve the injected
SDK-growth identity callback in host composition and its host-specific test.

Delete the old executor/gateway/ports host modules after all imports migrate;
do not retain forwarding barrels. Move focused owner tests with their source,
but keep host integration tests and cross-context fixtures in the host.

### Preserved guarantees

1. Every persisted ID and hash keeps the exact preimage, serialization, ordering
   and digest. The executor's serializer supports Date and bigint; it must not
   be merged with a plain-JSON serializer without proving the same contract.
2. Preserve claim acquisition/renewal/report expiry and every fresh read before
   an external effect. Keep current-generation, head and lifecycle gates.
3. Preserve signed capability key, kind, audience, issuer, exact permit, head,
   operation and expiration binding. Reconciliation-only sessions cannot mutate.
4. Keep credential/session cleanup in the existing `finally` paths. The move
   does not transfer worker lifetime ownership or add cancellation semantics.
5. Preserve marker and bot ownership, pagination, external-effect uncertainty,
   no-effect proofs, canonical receipt selection, sibling terminalization,
   pending-review recovery and optional PR-description aggregate behavior.
6. Preserve transactional final guards in the existing persistence adapters.
   Moving an application policy does not replace database authority.

### Qualification

Before extraction, freeze representative existing ID/hash outputs including
supported non-JSON values. Run executor/gateway baseline suites. After extraction
run the same behavioral cases, production runtime/maintenance/payload and
SDK-growth host tests, strict native TS7 feature/worker/tooling checks and emitted
exports. Reuse the existing production PostgreSQL review-v2 E2E, including
restart, expired-claim takeover, moving head and ambiguous marker recovery.

### Further execution responsibility separation

Independent review of the moved implementation identifies one remaining
substantial responsibility mix: the approximately 1,955-line finite executor
still owns external reconciliation, effect authority continuation and durable
settlement. Separate these responsibilities inside the same application owner:

- `PublicationOperationSettlement`: durable effect restoration, canonical
  receipt/completion, no-effect proof and terminal sibling settlement. It
  receives only existing attempts, command application, clock and digest
  capabilities; it cannot acquire SCM credentials.
- `PublicationExecutionAuthority`: existing freshness reads, effect admission
  and minimum mutation-lease continuation. It uses the existing narrow ports
  and the existing claim-renewal command. Renewal writes durable lease state;
  this collaborator is not pure. It cannot acquire SCM credentials or persist
  effects or receipts.
- `ReconcileReviewPublicationOperation`: external inventory, ambiguous-effect
  reconciliation and compensation through the existing credential, capability
  and compensation ports, plus the two internal services above.
- `ExecuteReviewV2PublicationOperation`: the existing public finite operation,
  command admission, claim acquisition and ordered orchestration. Its public
  constructor and result contract remain unchanged.

The dependency graph is acyclic: execution calls reconciliation, authority and
settlement; reconciliation calls authority and settlement. These are concrete
internal collaborators, not new public ports, a callback registry or a workflow
framework. Select capabilities explicitly instead of passing the full executor
dependency object to every service. Existing helper/command modules stay private.
Constructors perform no I/O. In particular, authority receives only the existing
`renewClaim` command capability, not all publication write commands.

Preserve every fresh read and renewal at the same effect boundary and in the
same order. Do not cache authority snapshots across operations. The raw
freshness read after stale compensation retains its distinct error codes and
must not be replaced by the general assessment helper. Reconciliation must
return an updated claim after renewal. Credential sessions remain local to
their original acquisition/finally scope; no service stores a session. Do not
add retries, broaden catches, alter hash inputs or transfer an external effect
into a component without its existing authority check.
Borrowed gateway helpers do not close their caller's session. Preserve the
completion path's view reload and expected version at its original position.

This closes a demonstrated responsibility boundary. It reorganizes existing
logic, not thousands of lines of new behavior. Retain the pre-extraction frozen
identity regressions, compare moved method bodies and re-run the meaningful
executor/host cases and production E2E. Two independent critics review the
seams after extraction, including the call order and uncertain acknowledgements.

## F. Complete E2E and independent review

The previous local 1,106 passing tests and real-component browser qualification
are retained evidence for A–C; they do not qualify D–E or replace PostgreSQL.
The exact prior head is `e4327acd50dece733b3e2794497447f08eb10caf`.
At continuation start, CI run 41741646669 has its Linux jobs queued, while its
macOS installer job and the separate memory-quality workflow succeeded.

The local executor has only UID 0 mapped, no privilege to create a non-root
identity and no Docker daemon. Native PostgreSQL correctly refuses to initialize
as root. Do not patch that check, simulate its identity, weaken the sandbox or
describe an embedded substitute as native PostgreSQL. Use the repository's
existing disposable PostgreSQL 17 and container CI jobs for actual execution.
Continue implementation and review while they queue; do not call queued work
successful or stop after merely requesting a run.

Required evidence for the completed source:

- Existing real PostgreSQL workflow race for ordinary and Hosted provisioning,
  plus persisted-success/audit-failure and external-response-loss settlement.
  Extend the existing fixture without creating a second framework.
- Provider-setup real database integration and secret-write boundary checks for
  the migrated adapters, preserving all authority and concurrency assertions.
- Production review-v2 PostgreSQL E2E using the real API/worker factories and
  synthetic external provider, plus the existing full self-hosted container E2E.
  Report these separately from a live GitHub/provider or production rollout.
- Focused meaningful behavior suites, strict native TS7 types/builds, source and
  emitted exports, formatting/lint and the required architecture checks.
- Multiple independent review rounds over domain ownership, hash compatibility,
  transactional authority, external uncertainty and actual host composition.
  Each material finding is fixed and re-reviewed against the changed source.
- Exact final-head CI results, with failures investigated and corrected. Keep
  the required branch checks and current execution environment contracts intact.

D and E are assigned to separate Astra/ultra implementers with cross-review;
an independent Astra/ultra critic owns the PostgreSQL qualification gap. The root
owns integration, plan/evidence, boundary checks and GitHub publication. Publish
every coherent commit immediately. The rollout registry remains pending until
an independently authorized deployment; this continuation does not deploy.

## Delivery, reviews and acceptance

1. Commit and immediately push this plan; open a draft PR.
2. Independently cross-review A/B/C, resolve material design comments, publish
   the concrete contracts and only then implement each lane.
3. Reproduce the selected behavioral defects with existing focused/PG fixtures.
   Keep the before/after result bound to the baseline and changed source.
4. Commit and push each coherent implementation checkpoint immediately. Use
   the maintained owner identity (`iliya <iliyazelenkog@gmail.com>` locally or
   the explicitly accepted GitHub integration alias `Илия` with the same email)
   and preserve contributor identity. Publish through the connected GitHub
   plugin when local Git has no authenticated write transport.
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
- Baseline five focused suites: 116 passed, one pre-existing skipped scenario.
- Plan published in [PR #810](https://github.com/777genius/review-router-ai/pull/810).
- Three independent plan cross-reviews accepted the scope subject to the exact
  contracts below; implementation and final qualification remain pending.

## Reviewed contracts before implementation

### A: external effect, settlement and audit are separate phases

Both terminal port methods return `"applied" | "superseded"`. Applied means
the transaction completed and the final scoped update affected exactly one
row, not merely that its preceding read matched. Missing scope, changed attempt
or a zero-row update means superseded. An exception remains uncertainty.

Keep successful public PR return shapes. Introduce one bounded typed outcome
error with safe codes `workflow_provisioning_superseded`,
`workflow_provisioning_persistence_uncertain`, and
`workflow_provisioning_audit_unavailable`. It retains immutable attempt identity,
the known settlement stage and any observed PR internally. An audit-unavailable
outcome after successful settlement explicitly carries the committed PR. Hosts
must recognize that it is committed and direct the user to inspect/refresh its
state; they must not show an ordinary provisioning failure or encourage another
unconditional create. Public responses expose only the approved safe projection.

- Entering the GitHub gateway means external effects may exist even when it
  throws. Do not infer that a thrown request made no remote changes.
- A returned PR followed by a refused or throwing terminal write never enters
  `markFailed`, never clears the PR identity, and never appends either ordinary
  success or failure audit. No automatic remote retry or deletion is added.
- A known applied success reaches audit outside the provider-failure catch.
  Audit failure remains visible through the typed committed outcome; it is not
  swallowed and does not produce `workflow.setup_pr_failed`.
- A preparation/provider failure still uses the existing scoped failure write.
  Refusal suppresses failure audit; write uncertainty is surfaced. Preserve the
  original safe provider failure as context rather than replacing it with the
  last audit/settlement exception. The disabled branch follows the same rule.
- Migrate the hosted operator resume adapter and its result mapping. The web
  outer catch must not append its generic failure audit for these outcomes.

The host extraction is specifically readiness policy and verified source
reading. Move `workflow-setup-readiness` into the feature application, with an
explicit public API URL rather than environment/Next dependencies. Consolidate
repository/commit/blob evidence decoding and hashing in the feature's GitHub
infrastructure for Next confirmation, rotating activation and hosted activation.
Retain transport-specific canonical validators and safe error mappings.

Do not move the full confirmation state machine or the rotating ledger. Keep
the existing repeated authority/source/binding rechecks around effect boundaries,
the distinction between desired config and installed transport, and separate
installed-only Gateway confirmation. The latter's audit semantics and the
organization-ruleset lifecycle are outside A's outcome guarantee.

### B: preserve aggregate lifecycle authority and exact recovery proof

The shared resolver keeps the existing aggregate-by-scope policy. One blocked
mutation-eligible target makes the aggregate `Changed`; target-specific
scheduling/replanning is not introduced. Preserve the API's artifact/execution
consistency checks, deterministic publication-attempt identity, persisted
attempt execution/generation/projection/head/revision comparisons, then the
existing binder's canonical operation/body/marker/head/watermark checks.

A missing publication before its first request means no own-operation exemption;
it is not automatically unavailable. A mismatched persisted publication is
rejected. Never derive the exemption from a fresh plan or similar thread.

Missing execution/artifact/authorization remains `Missing`; malformed projection
is `Invalid`; failed reads, missing required ports or activation cuts are
`Unavailable`; absent required per-thread history or a foreign-blocked history
is `Changed`. Preserve the existing runtime snapshot parser's actual behavior:
null/absent compatible input means no capability; thrown malformed input remains
unavailable. Do not convert parse errors into legacy admission.

Both hosts inject their existing stores. With no mutation-eligible targets,
skip history/activation reads so ordinary discovery remains possible. The
application receives narrow publication-owned facts and an injected digest;
host adapters translate other contexts' data without importing another app.
Reconciliation, receipt recording and `recordPendingResolution` are unchanged.

### C: migrate adapter types and reject the reverse dependency

Move adapter-owned types, including `ReviewPolicyReader` and
`ProviderProfileWriteOptions`, with their implementations. Enforce alias and
relative imports from core into selected outer layers, and root forwarding
exports that reintroduce those layers, including type-only edges. Migrate mocks,
namespace/dynamic consumers and production export emission. The selected rule
is a bounded adoption; it does not claim purity of the legacy Codex/provider
graphs or extend unrelated strict-context constraints to these packages.

## Implementation checkpoints and review refinements

Checkpoint `43ee9501106422f1d53a9dc1d43a2a6609d0fc07` published A1, B and C
immediately after creation. Source author and committer are the maintained
integration identity. The PR is ready for review so existing required CI can run
while the remaining bounded work and critics continue.

- A1 discriminating regressions failed against the original outcome handling.
  The focused workflow/host batch passed 340 tests; expanded outcome/host
  suites also passed. Exact stale-attempt PostgreSQL assertions were strengthened.
- B's same two host regressions passed for the original API but failed for the
  original worker (foreign pending ownership and malformed projection). The
  shared resolver batch passed 110 tests, with one existing skipped scenario.
- C passed 41 architecture harness cases, the direct architecture check and
  361 tests across migrated consumer/mock suites. The selected three packages
  build and resolve their composition entries under source and production
  conditions. This is not full production startup qualification.
- Native TypeScript 7.0.2 passed the affected feature/API/worker/web/modular
  projects. Tooling also passed after building shared outputs, including the
  existing production E2E harness now covered by its native project.
- A2's readiness/source extraction passed 341 tests across eight focused suites
  and native workflow-provisioning, repo-health and web checks. The existing
  probe contract moves to its workflow consumer to avoid a package cycle;
  repo-health retains type re-exports. A small pure mode classifier lets the
  web adapter preserve lazy URL-error semantics with an explicit application
  value. There is no environment-reading property getter in the contract.

These test groups overlap and must not be added into a claimed total. Native
PostgreSQL cannot run in this local UID namespace. Real PostgreSQL concurrency
and API/worker E2E execution are pending the existing CI services; no local PG,
live GitHub/provider or deployment success is claimed.

Implementation review round 1 found the following bounded gaps. They are part
of acceptance; each is implemented and independently re-reviewed in round 2:

1. The official Hosted Pool CLI discarded the precise operator error and known
   committed PR on non-2xx responses. Preserve only approved outcome codes and
   validated committed PR fields, with inspect-before-retry guidance. Do not
   print arbitrary response fields or internal causes.
2. Selected packages could add an infrastructure alias under a harmless export
   name. Pin the selected packages' existing public subpaths and their exact
   source/type/production targets, preserving review-config's five legitimate
   domain subpaths. Include those core entrypoints in the bounded purity walk;
   do not build an all-repository alias resolver.
3. When the gateway threw but the failed-attempt write applied, the original
   provider error still lost the fact that external effects may already exist.
   Complete that narrow contract with `workflow_provisioning_external_uncertain`:
   gateway entered, no confirmed PR response, exact failure settlement and any
   existing failure audit applied. Keep the internal original safe summary and
   cause; expose no committed PR. Hosts direct the user to inspect current
   status and GitHub before another setup request. Preserve approved recovery
   diagnostics such as an untrusted workflow path. Preparation failures before
   gateway entry retain their existing behavior. No retries, new ledger or
   reconciliation engine are introduced.
4. Remove the now-unused API `exactRestoredPublication` helper and its redundant
   isolated test. Its active proof lives in the publication feature; keep the
   independently used `persistedReviewExecutionRestore` helper.

The fourth outcome above refines the original three-code settlement/audit
contract after two independent critics reproduced the host information gap.
It does not change the database's known failed-attempt state into persistence
uncertainty. Preserve cleanup of the new transient dashboard parameter and
redirect presentation as part of the same host contract.

### Review round 2 and integrated qualification

The A2 extraction was published in
`fd49d426000c5277c14ddf9dc2d2637cce8946d9`. Root and both independent critics
checked branch precedence, trusted URL semantics, dependency direction, Git
object verification and the retained source/authority/binding rechecks. No
material extraction issue remained; a dead catch around an explicit URL value
was removed in the follow-up.

The follow-up closes all four findings above. Both critics reviewed the stable
four-outcome application and all active web/operator callers. They also reviewed
the CLI safety projection and the strengthened boundary guard. No confirmed
material findings remain in that source review. These reviews do not replace
the still-pending real PostgreSQL execution.

- Follow-up outcome/host batch: 361 passed; isolated Hosted diagnostics action
  suite: 58 passed after its fixture reset was made explicit.
- CLI transport and bulk result suites: 27 passed, including approved 503
  outcomes, committed result validation, mixed results and suppressed private
  fields. No extra remote requests are made for recovery.
- Boundary harness: 44 passed; existing execution restore suite: two passed.
  Native modular and direct architecture checks passed again.
- Native API and web passed for the final follow-up. One concurrent web check
  was killed without diagnostics; its sequential rerun passed.
- The full architecture subgates passed: source/profile, Foundation checks,
  dependency/registry assertions, memory/statistics negative qualifications and
  history. The `tsx` CLI's local IPC bind was unavailable; the identical script
  entrypoints ran with `node --import tsx`, without weakening their checks.
- Browser qualification uses the actual setup panel, buttons, shared warning
  presentation, toast and CSS, with fixture action/router boundaries. Keyboard
  submission produced one request; committed setup retained its PR and merge
  step, and superseded/persistence/external uncertainty did not falsely advance.
  Desktop/intermediate/mobile and both themes were captured and inspected.
  The 200% text check found the PR action below the fixed toast's viewport;
  the existing toast now limits height and allows scrolling. The focused action
  remains reachable without changing the ordinary notification layout.
  This is client-component qualification, not authenticated full-app E2E.

### Initial A–C integration review and recorded results

Production source is published at
`b29d5ba3d7ef5919f08bfaa9ee68ceb8a31fe8e9`. The final follow-up changes only
existing tests and this evidence/deployment documentation; the production source
qualified by the builds and critics is unchanged.

The broader existing-suite run exposed one old attempt-isolation expectation
that still treated a superseded PR as a successful return. The regression now
expects the typed superseded outcome and uses its observed artifact. It retains
every existing branch/content/state/confirmation assertion and observes the
older promise's rejection immediately. Its four cases pass.

A third independent integration review found two setup defects in the new
PostgreSQL E2E before that test was executed: closing the first harness did not
remove seeded unique identities, and the lifecycle-profile option alone did
not create a captured capability with the default rotating policy. The corrected
case resets the disposable database, saves a real Gateway account/binding and
repository policy with a qualified profile, and verifies the actual persisted
capability's transport/model. It then checks unactivated history, real
finalization/outbox/worker progression, snapshot/comment/check, exactly the
summary and managed-check operations, and two successful durable receipts.
No capability is injected and no live model dispatch is claimed. A second
critic accepted the corrected fixture; native tooling, lint and formatting pass.

| Final available check                     | Observed result                                                                                                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integrated existing suites, 58 test files | **1,106 passed, 0 failed, 18 skipped**                                                                                                                                                                           |
| Explanation of the 18 existing skips      | 15 require PostgreSQL; two require paired Action golden artifacts; one requires the compiled CLI smoke configuration. None was added or disabled to make this change pass.                                       |
| Native TypeScript 7 builds                | All seven pass: workflow-provisioning, repo-health, review-config, audit-log, review-publishing, API and worker.                                                                                                 |
| Additional native projects                | Web, modular, tooling (including corrected E2E), spikes and Hosted Pool operations pass.                                                                                                                         |
| Selected composition exports              | All three source/default and production targets resolve to existing source/emitted entries. This is not full application initialization.                                                                         |
| Changed-source ESLint and formatting      | Pass; 131 changed code files were linted at the production checkpoint, and both final test corrections were linted afterward. All changed files pass formatting.                                                 |
| Architecture                              | Direct 655-core-file check, 44 selected harness cases, full source/profile/Foundation checks, 23 memory and six statistics rejection cases, and history qualification pass.                                      |
| Real-component Chromium                   | 10 scenarios pass, including keyboard submission, no automatic repeated request, status/PR presentation, transient URL cleanup, width/theme matrix and the reachable action at 200% text. Screenshots inspected. |
| Independent source review                 | Plan review plus two implementation rounds and final integration review; all confirmed material findings above addressed.                                                                                        |
| GitHub required CI / real PostgreSQL      | Pending runner execution; not a pass.                                                                                                                                                                            |

The integrated command uses Vitest with one worker and the changed non-PG
consumer tests, the complete workflow-provisioning and publication-v2 test
directories, and the existing worker/CLI boundary suites. Native commands use
`node scripts/local-checks/compiler-cli.ts --native`, with `GOMAXPROCS=2` and
bounded memory; no dependency or compiler pin changed. Disposable detailed logs,
JSON results and browser captures remain in the ignored `tmp/foundation-e2e`
and `tmp/foundation-ui` directories.

At `2026-11-03 23:44 UTC`, the required source-check jobs were still queued.
The local UID namespace cannot start native PostgreSQL under a non-root user,
so real-PG execution is delegated to the existing CI services without weakening
their gates. The branch remains unmerged and no deployment was performed.

External automation is recorded separately from agent review: CodeRabbit skipped
the PR because its 100-file/capacity limit was exceeded; it did not review this
source. Strix reported no open security finding for checkpoint `43ee950`, and
explicitly reported subsequent commits as unreviewed. Neither status is claimed
as an external approval of the final head. GitHub had no inline review threads.

Runner queue state must never be reported as successful execution. Ordinary
rollout remains pending in the deployment registry and requires its own
environment-specific verification.

### Continuation recovery and current-source verification

The transferred conversation stopped before the latest implementation report.
The live PR and preserved checkout both identify
`5a18c8ca4b36d124df615ff5f4848790f11eb918` as the continuation checkpoint:
provider-setup persistence and its domain policies have moved to their owner,
and publication execution, credential routing and signed capabilities have
moved out of the worker. The final execution responsibility separation in E
and independent continuation review are still in progress.

Actual job results supersede the workflow collection's stale `queued` summary.
For CI run `41745190369` at that exact head:

- The dedicated Release Authority PG17 contract passed. The Quality job also
  executed all 22 real PostgreSQL workflow provisioning cases successfully,
  including both setup transports, stale attempts, post-commit audit failure,
  persistence uncertainty and a lost external response.
- The full test step found 18 failures in two review-config test files. Static
  checking and the separate Gateway-grants PostgreSQL lane identified the same
  missed migration in three tests: concrete adapters still came from `../index`.
  They now import `../composition`, without restoring infrastructure exports
  from the application root or weakening their assertions.
- The corrected review-config slice passes all 201 tests in 13 non-PG suites.
  Native TypeScript 7.0.2 checks the full feature `tsconfig.json`, including its
  tests; ESLint and formatting pass for all three corrected files. Feature
  build-only evidence did not cover those tests and is not claimed to do so.
- Source certification reports `conflict_runtime_bundle_stale`; regeneration
  and final-source qualification are pending. Production API/worker PostgreSQL
  and self-hosted container E2E must still complete on the final source.

The prior 1,675-pass local continuation JSON also contained one failed suite
load, despite zero failed assertions. The missing provider-setup composition
workspace resolution was corrected at `5a18c8c`; that earlier JSON is retained
as diagnostic evidence and must not be described as a successful full run.
The final integrated rerun must include suite-load status, not only assertion
counts. Logs remain in ignored `tmp/foundation-e2e/recovery/`.

### Completed D–E implementation and continuation critic rounds

The remaining finite publication executor is separated at the reviewed internal
responsibilities. The public executor is 694 lines (previously 1,955), with
956 lines in reconciliation, 427 in durable settlement and 99 in execution
authority. This relocates existing behavior; it is not new publication logic.
No public constructor, protocol, hash input, command identity, scheduler or
credential lifecycle contract changes. Authority receives only its claim-renewal
write capability; settlement cannot acquire SCM credentials. The final fresh
attempt read and completion version remain at their original execution position.

The author froze and reran the same 83 executor/gateway cases before and after
extraction, including unchanged in-flight identity snapshots. The larger
publication/host selection passes 319 assertions; its 15 conditional cases need
PostgreSQL or the paired Action golden artifact. Native TypeScript 7.0.2 feature
typecheck/build, worker and tooling checks pass. Root and an independent critic
read all four resulting files and compared all original method bodies, including
the separately extracted completion tail, exact effect order, renewal return
values, raw compensation postcheck and locally owned credential sessions. No
material extraction regression was found. These reviews retain the existing
behavior and do not claim a new resource-lifetime guarantee.

An independent D review found two pre-existing disagreements in the memory
implementation of the same setup lifecycle port: confirmed-plus-unknown was
accepted, and an expired duplicate confirmation retired a confirmed attempt.
The adapter now consumes the same domain dispatch decision as Prisma. Expiry
retires only an authorized unconfirmed attempt; a confirmed candidate survives
for valid activation within its recovery window. The shared allocation bound,
replay deadline and exact attestation equality replace their duplicated rules.
Existing memory-specific recovery admission and synthetic authority remain.

Two strengthened existing ledger scenarios failed against the previous adapter
(19 passed, two failed) and pass with the correction. The ledger/reattestation/
policy group passes 46 cases. A second independent critic reviewed all changed
branches and production parity, then independently ran 35 relevant assertions,
all passing. No production code instantiates this memory fixture; the change
improves the fidelity of its executable contract rather than adding authority.

Integrated current-source verification covers 115 existing test files:
**1,876 passed, zero failed, 81 conditional skips, report success true**.
The skips are 78 PostgreSQL-dependent cases, two paired Action golden cases and
one compiled operator CLI smoke. Required database qualification is tracked in
CI separately; no skip is treated as passing. Native TypeScript 7.0.2 also passes
the full audit-log, workflow-provisioning, repo-health, provider-setup,
review-config and review-publishing feature projects including their tests,
API, worker, web, modular and tooling. The secret-write boundary passes with the
relocated adapter's exact audited path. The regenerated existing conflict-runtime
bundle passes its source parity check and existing artifact smoke.

The F review exposed two real coverage gaps: no existing workflow enabled the
three runtime-migration PostgreSQL cases or the five locked-provider PG17 cases.
The required DB lane now explicitly selects both, with a small strictly typed
result gate that rejects missing suites, skipped/todo cases, failures and
inconsistent totals. Its rejecting cases and the existing affected CI/artifact
contract suites pass (51 assertions). This is a bounded acceptance gate for the
selected setup owner, not a new test framework.

Independent F review found and corrected two dormant fixture assumptions before
their first required execution. The runtime-migration database now clones the
already-qualified ordinary application database before clients connect; it does
not replay migration 000079 after the later inert owner role exists. The
locked-provider fixture retains the exact historical managed92 catalog and
its non-superuser setup table owners, then verifies the current160 catalog's
prefix and all 68 extension checksums before applying those extensions through
the existing isolated container administrator. Its runtime clients retain their
original identity. Complete ordered migration names and visibility of current
Workspace fields are asserted; no select list hides schema drift. Shared
historical helpers and production migrations are unchanged.

The corrected guard/provider-CI/historical-catalog/managed-fixture selection
passes all 199 assertions. A second source/configuration critic accepted both
corrections with no remaining material finding. The modified locked-provider
TypeScript fixture is included in the maintained hosted-pool operations project,
and the required DB lane runs that entire project with native TypeScript 7.0.2.
The full project passes. Its inherited JavaScript interop helpers remain under
the existing `allowJs: true`, `checkJs: false` profile; no full JavaScript typing
claim is made. Final source-integration review also retraced A–C's terminal
authority, web/API/CLI projections, exact own-publication proof and composition
consumers, with no confirmed substantive finding.

At this local continuation checkpoint, final-head PostgreSQL and self-hosted
container execution are still required. Their actual results must be read from
the exact-head PR checks and recorded in the PR's final qualification evidence;
the local assertion counts above do not substitute for those executions.

### Actual PostgreSQL qualification and fixture quiescence correction

CI run `41755536925` tested head `163ef97c389601477db8db6becefbe33e0375bd9`
through merge ref `4af5636038043e7ca2324c817e43edca31f13e5e` against
`f952f7c8e72277c8367a20769db0b8d7bc548219`. The head and tested merge have
the identical Git tree `5bcb68cc2ec78b1f8ce2863f6351839d0dececea`.
Source/certification and static checks passed. Full disposable self-hosted E2E
passed, including all 14 production review-v2 PostgreSQL scenarios, both
same-release investigation cases, Action OIDC, the real memory installation
lifecycle, sanitized logs and verified sandbox removal. Dedicated release
authority PG17 passed its 60 assertions and worker repository-sync contract;
managed migration prerequisites passed 119 cases. These are observed execution
results, separate from the earlier local conditional skips.

The newly required setup DB step exposed another dormant fixture error. Its
three runtime-migration cases passed, but the locked-provider fixture failed
before its five cases could execute. Migration
`000089_workflow_provisioning_writer_quiescence` correctly rejected applying the
current extensions as the administrator while the separate `reviewrouter` role
could still log in and write. The failed step and its five skipped cases are
retained as failure evidence, not acceptance.

The follow-up correction quiesces only that disposable fixture role before
the administrator applies the checksum-verified extensions. It requires no
remaining client sessions, retains the original setup/provider table owners,
and restores the same non-superuser login only after complete schema and owner
verification, before constructing any runtime Prisma clients. Failed setup is
removed by the existing container cleanup. Production migrations, their
quiescence checks, historical fixture helpers and runtime grants stay intact.
Root and an independent fixture critic reviewed the exact ordering, failure
cleanup and ownership. The review confirmed that every table exercised by the
five cases belongs to the historical catalog, so no additional grants or
ownership changes are needed. The client-session assertion excludes unrelated
background workers while the unchanged migration retains its own admission
check. Native TypeScript 7.0.2 for the full hosted-pool operations project,
ESLint, formatting and 163 existing acceptance/catalog/fixture assertions pass.
The new head must execute all eight setup cases and the
remaining required CI successfully; final results and the merge are tracked
in #810 without treating this earlier failed run as a pass.

During qualification, main advanced to
`a3db73fd77eda829480f57ffe3f40ed7c9f9da06` through #809. The integration
preserves its quota-aware Gateway SDK, provenance, paired Action pin and tests.
The deployment-index conflict retains both task entries. Scope A–F remains
unchanged. Required acceptance now targets the combined source and current
main, including the fixture quiescence correction.

Independent integration review verified all imported main blobs and SDK
provenance, the combined lockfile and the retained eight-case PostgreSQL gate.
Frozen dependency installation passes all 1,068 supply-chain policy entries.
Five existing API/worker integration suites pass 178 assertions with zero
failures and one existing paired-Action conditional skip. Native TypeScript 7
for API, generated conflict-runtime parity and the secret-write boundary pass.
The combined head still requires its own complete CI execution before merge.
