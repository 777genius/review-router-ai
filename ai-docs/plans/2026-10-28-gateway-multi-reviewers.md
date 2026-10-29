# Several Gateway reviewers

Status: bounded implementation complete; final local qualification recorded below.
The plan was approved after three independent review rounds. Draft: [ReviewRouter #738](https://github.com/777genius/review-router-ai/pull/738).
Companion draft: [public runtime #351](https://github.com/777genius/review-router/pull/351).

Research baselines: ReviewRouter `b2f40048559a841f41b6756c8eac2ed90b04c2d4`
and public runtime `056952b5a3d625fd1d19384942d452114804380f`.

## User-directed scope

Deliver several reviewers/models in one review through ReviewRouter and Account
Gateway, including frontend configuration, persisted policy, immutable runtime
capture, bounded concurrent execution, truthful outcomes and one aggregate
publication. The user authorized draft pull requests, incremental commits and
pushes, end-to-end qualification, review fixes and merge after the required
checks pass.

The later mixed Gateway plus GitHub Secrets/direct scenario is a definite next
stage. The shared reviewer identity, planning and outcome contracts must admit
that extension without making it part of this delivery. Reuse existing semantic
owners and their narrow ports. Do not introduce a universal scheduler, provider
plugin platform, a new state machine beside the current review execution, or
duplicate publication logic.

Feature flags are not part of this delivery. Introduce or enable feature flags
only when the user explicitly requests them. The separately assigned removal
of the account-catalog flag and current deployment remain another task.

## Initial boundaries

In scope:

- Add, edit and remove multiple Gateway reviewers using the existing provider
  forms, with independent model/settings and preserved single-reviewer behavior.
- Preserve every reviewer through workspace defaults, repository policy,
  immutable runtime capture, account authority, invocation and usage correlation.
- Distinguish reviewers that use the same execution engine or account with
  different model/settings; do not identify a reviewer by provider kind alone.
- Bound parallel work, preserve account limits and exact ownership, settle a
  failed reviewer truthfully, and preserve cancellation and cleanup evidence.
- Reuse existing work slots, required coverage, aggregation, agreement and
  idempotent GitHub App publication.
- Qualify both configuration and execution, including failure and cancellation.

Out of scope:

- Executing mixed Gateway and GitHub Secrets/direct reviewers in one run.
- New authentication modes, credential migration, native inference scheduling,
  automatic paid retries or fallback models.
- Simultaneous rollout, infrastructure migration or public workflow-channel
  promotion; source implementation and activation remain separate operations.
- Unrelated account/catalog, memory, skills, terminal or CI refactors.

## Existing owners and research findings

Three GPT-6.1 Sol/xhigh researchers independently inspected domain/frontend,
control-plane authority and public runtime. Their findings agree on these owners:

| Responsibility                            | Existing owner                                                  | Change                                                                     |
| ----------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Stored selection and inheritance          | `features/review-config`, stored schema 4 and runtime schema 3  | Plural use cases and complete view models; keep the schemas                |
| Credential/profile identity               | `WorkspaceProviderProfile` and profile repository               | Reuse binding/profile/model identity and atomic draft resolution           |
| Admission and private execution authority | `features/review-run-control`, API capture and Gateway adapters | Versioned reviewer capture and bounded Gateway allocations                 |
| Durable slot/lease/evidence state         | `features/review-executions`                                    | Reuse exact vote-hash work slots and required coverage                     |
| Native inference                          | Existing Gateway service and native authority                   | No changes to their protocol or custody; reuse finite execution allowances |
| Runtime planning and scheduling           | Public runtime `review-orchestration`                           | Reviewer-aware adapters and bounded parallel inference                     |
| Consensus and publication                 | Existing projection/consensus and SaaS publication ledger       | Count distinct vote identities; one finalizer/publisher                    |

Stored policy already supports 1–16 selections. A reviewer is an existing
profile plus selected engine: exact duplicate profile/engine rows are invalid;
different bindings or models remain distinct. Settings alone do not turn an
otherwise identical profile/engine selection into another independent vote.
Repository overrides replace the complete roster; removing an override restores
the complete workspace roster.

Current gaps include first-element UI projections, duplicate-by-provider-kind
vote normalization, singular private snapshot/attachment, one Gateway session
per authorization, a serial runtime loop, and projection accounting by engine
kind. SQL migration 132 independently enforces the existing singleton attachment;
changing only TypeScript cannot deliver this feature.

## Product behavior and fixed scope

The editor shows a compact ordered reviewer list, Add reviewer, and existing
per-reviewer model/settings controls. One Save commits the complete list. The
same editor supports workspace defaults and repository replacement/inheritance.
The plural selection write accepts the narrow execution-settings patch edited
here and persists both roster and patch in the same policy/digest transaction.
Repository fields retain the existing inherit/override semantics: untouched
inherited values remain absent, rather than copying effective values into an
override. Reuse the existing execution fields, not the whole settings form.
The editor submits the workspace/repository policy versions it displayed,
including the inherited workspace version where relevant. Reuse existing CAS
and dashboard_action_stale; do not automatically retry a stale whole-list draft
against a newer head. Keep the draft visible for refresh/review. Existing
singleton adapters retain their previous semantics. Workspace shrinking must
retain descendant override validation: reject atomically if an inheriting
repository's explicit agreement/parallel setting no longer fits; do not lower
that repository's explicit requirement. Show an actionable override error.
Default badges, list summaries, readiness and row-specific edit/remove actions
must represent every selection. Removing one reviewer cannot clear the roster.

The first reviewer is the captured primary for existing non-voting PR description
and lifecycle tasks. This reuses today's ordering rule; no new primary selector,
weights, drag-and-drop or per-reviewer billing UI is added.
If an optional primary becomes unavailable, auxiliary work reports the existing
unavailable/incomplete result; required review coverage may still complete.
Do not silently promote a sibling or select a fallback model.

Reuse the existing Max parallel providers and Inline agreement controls in the
roster editing flow. Preserve saved values. Adding a reviewer does not silently
raise parallelism; shrinking the roster uses the existing fit-to-count policy.
The concurrency acceptance scenario explicitly saves two reviewers and a limit
of two. Every configured phase-one review contributes required coverage, matching
the existing runtime. Preserve `requiredHealthy` when editing a selection: it
controls the existing health preflight and does not make that review's coverage
optional. The runtime retains its existing explicit optional-slot contract for
authorized work; this editor adds no optional-reviewer switch.

All-Gateway rosters are executable in this phase. Existing singleton direct,
GitHub Secrets and Hosted Pool routes remain on their current contracts. The
generic saved-policy parser remains able to read historical configurations;
the existing transport eligibility owner rejects unsupported mixed execution.
Support already executable Gateway engine profiles without introducing a new
engine or authentication mode.

## Reviewer identity and immutable capture

Introduce a private snapshot version 4 for newly admitted multi-reviewer runs.
Retain the exact version 3 parser and existing singleton execution identities
for already-admitted work. Shared policy, producer, revision, deadline and
captured context facts occur once. Each captured reviewer contains:

- A stable opaque reviewer ID derived by one versioned canonical identity
  function from the existing selection identity and approved engine profile.
- Original provider index, exact authorized provider vote hash, requiredness,
  captured agent profile and its digest.
- A discriminated transport selection. Phase 1 implements only
  `account_gateway`; future direct/Secrets arms belong to their later delivery.
- The reference to its captured Gateway allowance allocation.

The server derives the vote hash from the approved engine lane seed and exact
captured reviewer identity. Resolve Default against the exact admitted producer
before deriving identity, then reject duplicate normalized workspace-profile
identity plus resolved engine profile identity/digest. An implicit Default and
its explicit equivalent cannot become two votes; settings and row index do not
differentiate them. The workflow cannot nominate another model, account,
engine or vote. Duplicate hashes and reviewer IDs fail closed. Provider kind
remains engine metadata, never a reviewer key. Preserve the configured roster
order and bind it into the existing policy/plan digest.

Snapshot parsing, identity and reviewer resolution belong to
`features/review-run-control/domain`. Authorization and preparation ports use
these primitive domain values. SDK types and Prisma remain in their adapters.
Version 4 is bounded to 16 reviewers and a finite 128 KiB private envelope;
maximum-shape tests must qualify the bound without widening unrelated clients.
Version 3 retains its existing 32 KiB parser and independent SQL bounds.

## Gateway allowance and selected execution custody

Choose shared execution per exact binding/Gateway-profile/epoch for reviewers
that use the same account with different models. This preserves the existing
finite request and concurrency allowance instead of copying it once per model.
Different authorized binding/profile selections retain their own independently
approved allowances. Tokens and byte caps remain per-request bounds; this does
not introduce a new aggregate token-billing promise.

An allocation is only a captured finite Gateway execution entitlement. It is
not another scheduler or quota ledger. Grouping and IDs are deterministic and
private, derived from immutable captured authority. Each reviewer still has an
independent model, model settings, vote identity and request identity. The
existing Gateway executes and enforces the shared request/concurrency budget.
Grouping binds the full original preparation intent: selected account,
binding/connection and policy revisions, subject, deadline, profile and every
allowance. If the expected epoch is absent at capture, attachment records the
selected epoch once; it cannot later change. All first users join one shared
preparation promise instead of treating an in-flight preparation as a denial.

Add one write-once child relation for version 4 selected Gateway executions,
keyed by authorization ID and allocation ID. Preserve the old parent field and
its constraints for version 3. An additive migration independently validates
the child against the exact captured allocation, account, epoch, deadline and
active parent; immutable fields cannot be overwritten. Keep the existing lock
order, and lock distinct bindings deterministically. Allocate the migration
number against current main immediately before implementation to avoid other
tasks' migration collisions.
Write-once includes deletion/reinsertion while the parent is retained. Controlled
parent retention preserves unresolved cleanup evidence; test attachment racing
parent termination as well as concurrent insertion and exact readback.

Preparation uses one new versioned operation/invocation/attempt namespace per
allocation. Concurrent reviewers share the same preparation promise/result;
restart restores the same operation. Unknown preparation, failed attachment and
cleanup follow the existing no-replay/reconciliation rules. No inference is
replayed and no fresh allowance is minted to recover an ambiguous result.
Cleanup after restart/expiry has a narrow read-only recovery path: prove the
original operation exists before any run-access call, restore only that exact
captured execution (including a closed/expired result), and permit cleanup but
never dispatch. A missing original operation cannot create a replacement.
Unknown recovery stays unknown. Reuse Gateway's existing exact-operation and
terminal execution readback; no new Gateway/native API is required.
The original-operation proof uses the already composed backend consumer-control
operation query port. The run-control role cannot read operations; do not widen
its role or rely on a permissive HTTP fixture.

Relay methods resolve an explicit captured reviewer selector before choosing
the allocation, model, settings, authorization epoch and request usage identity.
A missing selector is valid only for an exact singleton legacy snapshot. Unknown
or cross-reviewer selectors fail before preparation/dispatch. Relay request IDs
include the reviewer identity, even when the underlying execution is shared.

Request-level usage is attributed to its exact reviewer/model while execution
preparation/cleanup remains allocation-owned. Parent cancellation or final close
revokes all unique allocations once. Closing a local reviewer session does not
revoke its siblings' shared allowance. Expiry/restart cleanup discovers every
persisted allocation and preserves unknown physical effects.
Persist request-to-reviewer ownership through the existing usage parent scope
or its narrow owner extension; shared execution ID alone is insufficient.
Primary auxiliary requests consume and are attributed to that same allocation.

Version 4 parent authorization validity is separate from allocation liveness.
Admission validates the full roster; later allocation operations validate only
their selected authority. Parent workspace/SCM/revision/producer/token failure
remains run-wide. A revoked binding cannot prevent healthy siblings, evidence
reporting or finalization. Preserve version 3 validity semantics. Normal resource
cleanup must not revoke parent authority before aggregate publication finishes.
Retain snapshot integrity, context eligibility, safety, registered producer,
SCM revision and both token/database deadlines in the shared parent checks.
Keep exact deterministic vote-lane order for token/record comparison; unique
engine/task pairs may still serve existing safety selection without merging votes.

## Public runtime plan and compatibility

One safe versioned reviewer-plan schema/parser lives with existing shared
agent/runtime contracts in `packages/shared`; the canonical generator/exporter
delivers it to the public Action. Do not maintain a second hand-written parser
or edit generated output manually. Export only after committing the source.

The public plan contains reviewer ID, provider index, vote hash, selected safe
model/settings, captured engine profile/digest, requiredness, primary reviewer
and effective parallel/agreement limits. Each reviewer also carries an opaque
concurrencyGroupId; group permits are min(captured grant concurrency, number of
dependent reviewers). These safe scheduling hints confer no execution authority.
The plan contains no upstream credential,
private account ref, selected execution capability or server allowance.
Bound the public plan to 64 KiB and validate it before any provider effect.
Qualify the entire encoded checkout/readback envelope, including environment
JSON escaping and tokens/profiles. Keep it within the existing client limit or
add a bounded version-specific checkout limit; do not widen unrelated clients.

Each v4 reviewer has an explicit captured investigation grant projection in
reviewer-plan v1, bound to its reviewer ID, vote, model and profile digest. Reuse
the existing descriptor's capability vocabulary and validation for each scoped
input, without widening or changing historical V3 descriptor bytes. Derive the
grant from that reviewer's admitted authority; a kind-level grant must not
implicitly authorize every same-kind reviewer. The actual server/wire parser
must prove authorized and unauthorized same-kind lanes remain distinct.

An immutable top-level ProducerReviewerPlanProfile (version and descriptor
digest) proves that the producer can consume reviewer-plan v1. It belongs to
the existing orchestration manifest, attestation and immutable registry, not to
each model-engine profile. Keep historical agent-profile exact keys/digests.
This is a compatibility fact, not an environment flag or rollout toggle. Deny new
multi-reviewer admission for older producers rather than letting them ignore
the plan. Keep legacy singleton environment behavior and approved direct routes.
The neutral workflow inputs/OIDC permissions stay unchanged.

## Runtime composition and parallel scheduling

Keep one parent `ProductionT0ReviewRunner`, one SCM checkout, one authorization,
one `ReviewExecution` and one final projection/publication. Do not run complete
runners concurrently: their outer environment setup mutates cwd/process.env.

Create a bounded map of existing invocation adapters keyed by exact reviewer
vote identity. Each reviewer owns an isolated private HOME, model transport,
loopback capability, prepared engine environment, reasoning settings and
effect/failure state. Shared read-only checkout is allowed; mutable engine
state is isolated. Provider kind never selects a same-kind sibling's adapter.
The application layer sees existing invocation ports, not Gateway HTTP or
future secret materialization.

Retain engine-specific planning: Codex uses stable batch assignments per exact
reviewer; every managed OCR reviewer gets one full canonical eligible-inventory
FindingDiscovery slot, preserving its qualified internal grouping and preview.
Combine these exact lane assignments into one existing canonical work plan.
Stable lane IDs distinguish multiple OCR reviewers even though their engine
provider name is always ocr/managed. Do not add a universal planning framework.
Budget required OCR slots plus complete required Codex groups against the
existing maximum slot count before dispatch and before optional companions.
Preserve truthful uncovered-file coverage and reject a plan that cannot fit
its minimal required group. Optional description/lifecycle work uses the
captured primary and existing remaining-slot rules; it does not multiply.

Add bounded scheduling within the existing orchestration use case. At most the
configured reviewer parallelism runs, and one reviewer's batches are serial
because its transport permits one request at a time. Gateway's granted/account
limits remain independently authoritative. Native execution may overlap; one
coordinator owns current execution state and serializes version-sensitive
adoption/supersession/finalization. Out-of-order replies cannot lower the known
stream version. Restore/reconcile once all workers settle before finalization.
Use a small serialized command function in the existing use case, not a queue
package or command bus. Acquire and fresh attach retain their existing lease
contracts; exact-revision reuse/adoption and other version-sensitive mutations
refresh/serialize through this parent command boundary. A final restore alone
cannot repair a reuse operation already sent against a stale stream version.
The same scheduler acquires a small per-concurrency-group permit before starting
a reviewer, as well as the global permit. A concurrency-one shared allocation
therefore queues siblings before any model POST, including long-running calls.
Do not use saturation polling/retries as a substitute for local admission.
Select a ready group before holding a global permit: a sibling waiting behind
its busy group must not occupy capacity that an independent group can use.

Parent cancellation, supersession or a run-wide authority failure stops new work,
aborts all children and drains them to settlement before release/finalization.
Failure classification receives the exact work-slot/invocation identity and
reads that reviewer's transport facts. The existing result gains only three
necessary scopes: reviewer/request, captured allocation, and parent run.
Reviewer-local failure settles that reviewer. Allocation terminal/unknown state
(including exhausted budget, epoch revocation or ambiguous preparation) stops
all dependent reviewers and settles their captured required coverage; another
allocation may continue. Parent authority failure stops every child. Preserve
unknown physical effects on the exact transport and never recover by minting
another allowance or replaying an uncertain paid request. The existing narrowly
proven unpaid-saturation behavior stays. No separate error framework is needed.

## Aggregation and preserved auxiliary behavior

Existing exact work-slot/vote identity must bind every invocation manifest,
accepted observation and projection assignment. Count distinct reviewer vote
hashes in execution summaries and consensus; do not count distinct engine kinds.
Reuse the current consensus algorithm, required coverage and finalized artifact.

A required reviewer failure/timeout produces incomplete coverage, not an empty
successful review or a lower agreement denominator. Preserve existing partial
publication: incomplete advisory, no approval or inline/lifecycle publication.
Repeated finalization/publication restores the same artifact and effect record.

Skills/context capture stays shared and immutable, while eligibility and access
resolve the exact requesting reviewer. Existing engine capability requirements
apply to each selected reviewer; incompatible saved tool/engine combinations
are rejected explicitly. PR description and lifecycle verification use the
captured primary only. Do not disable or duplicate existing richer features.
Instantiate the existing investigation composition per eligible Codex reviewer,
with its exact model, approved profile, capability and transport, then route its
invocation/recording port by exact work-slot vote. Kind-based selection must not
borrow a sibling's authority. OCR keeps investigationProbePlan: null and its
native context behavior. Apply skill eligibility separately to every captured
engine, retaining the existing invocation-key/payload-hash receipt collector.

## Implementation ownership and dependency order

1. Domain/shared reviewer identity, private snapshot v4, producer capability and
   safe public plan; pure positive/negative fixtures; additive attachment schema.
2. Capture/authorization/allowance grouping, write-once persistence, preparation,
   relay, selected settings, usage and cleanup; actual PostgreSQL/HTTP tests.
3. Plural selection use cases, complete server views/readiness, one reusable
   roster editor and summaries; preserve singular caller adapters where needed.
4. Commit canonical protocol changes, run existing generator/exporter into the
   companion Action branch, then implement per-reviewer sessions, exact lane
   binding, bounded scheduling and projection accounting.
5. Join actual API/database/runtime/browser tests, rebuild committed public
   bundles, fix independent code review, and run required exact-head gates.

Source ownership may be parallelized after shared contracts are fixed. Commits
must use `iliya <iliyazelenkog@gmail.com>` for author and committer and be pushed
immediately. Keep the ReviewRouter and Action PRs draft until qualified; use the
existing owner merge guard after reviews and required checks. No npm package,
native/Gateway service change or new dependency is planned.

## Validation and release boundaries

Required behavior cases:

- Two models on one binding: distinct identities/settings and actual overlapping
  model calls with saved parallelism two and granted Gateway concurrency two;
  total requests consume one allowance. A concurrency-one grant keeps the saved
  cap but completes within that grant without another allowance or paid replay.
  Controlled/virtual timing exceeds the existing 120-second saturation window;
  the waiting sibling makes no POST until its group permit is released.
- Two bindings: independent credentials/capabilities; wrong reviewer/account,
  stale binding epoch, removed model and mutable post-admission policy denied.
- Exact duplicate selections denied; 1/16 accepted and 0/17 denied; bulk draft
  resolution, full inheritance and removing one reviewer preserve the rest.
- Default plus its explicit resolved engine is rejected as a duplicate, including
  the supplied-diff default. Distinct actual engine profiles remain valid.
- Save one to two reviewers and parallelism two atomically; failed save changes
  neither; repository agreement stays inherited when only parallelism overrides.
- Two open dialogs cannot erase each other's newer roster/settings; a stale save
  preserves the user's draft. Shrinking a workspace roster rejects incompatible
  explicit descendant overrides without changing either policy.
- Out-of-order completion, shared budget exhaustion, one required failure,
  optional failure, deadline, cancellation and supersession all settle truthfully.
- Preparation/attachment restart, uncertain dispatch and duplicate finalize do
  not create new inference or publication effects.
- Same model through distinct bindings and different existing engine profiles
  retain independent vote identities and appropriate per-engine capabilities.
- Existing singleton Gateway and approved direct/Secrets flows remain valid.
- Revocation/exhaustion of a shared allocation stops its two reviewers while a
  third on another allocation finishes and one truthful partial result publishes.
- Shared first-prepare races, restart around attachment, missing original cleanup
  operation, foreign selector/request pairs and usage reconciliation after
  revocation do not change authority or lose attribution. Old producers reject
  plural admission before preparation.
- Mixed reuse/fresh evidence with reversed response timing finalizes once from
  authoritative state. Concurrent distinct failures read their own effect facts.
- Multi-batch Codex plus OCR still runs one full-inventory slot for OCR; two OCR
  reviewers have distinct lane identities. OCR primary plus Codex secondary and
  different Codex investigation authorities do not leak or suppress capabilities.

Use existing real PostgreSQL admission/migration and HTTP relay fixtures, the
paired Action/SaaS harness, and the existing browser provider-settings harness.
The execution E2E must exercise the actual composed API and compiled public
runtime with two controlled provider responses, observable overlap and one
aggregate publication boundary. A unit-level fake orchestrator is insufficient.
Extend the existing paired SaaS/DB/API fixture with a subprocess launching the
committed Action entrypoint, using the artifact E2E's synthetic approved-binary
preload boundary. The paired source-module runner alone does not prove this.
Record separate private homes/capabilities and actual saved model/settings at
child processes, shared versus independent allowances, a mixed Codex/OCR case,
one publication, drained child processes and one close per unique allocation.
Browser E2E must save/reload/edit the actual roster and verify independent model
settings and inheritance. Include committed-artifact smoke, targeted tests,
format/lint/typecheck/build, architecture/protocol checks and required CI.

Live GitHub/provider qualification, if performed, uses an existing disposable
repository and the configured GitHub App identity. Source merge does not itself
activate a producer. Production rollout, live credential availability and exact
public/private producer registration remain the existing separately owned
deployment process; do not bypass it to make a test appear green.

## Plan review process

The implementation plan will include exact owners/files, invariants, failure
semantics, compatibility, non-goals and meaningful verification gates. Perform
three rounds with multiple independent critics; record findings and concrete
dispositions after each round. A review round is not complete until its
blocking findings are addressed or the delivery scope is explicitly reduced.

- [x] Research and first implementation plan.
- [x] Review round 1 and plan corrections.
- [x] Review round 2 and plan corrections.
- [x] Review round 3 and final plan.
- [x] Implementation in dependency-ordered local commits.
- [x] Focused behavior, protocol, architecture, production build and runtime checks.
- [x] Browser and joined execution E2E on disposable resources.
- [x] Independent code reviews and concrete corrections.
- [x] Publish exact reviewed source trees through the owner's connected GitHub plugin.

Hosted integration is tracked by the checks and merge state on the linked SaaS
and Action PRs. Required CI must include the five Docker-dependent cases, and
merge requires the maintained owner identity/head checks after those gates pass.

Review ledger (findings and dispositions will be appended after each round):

| Round | Independent critics                                   | Blocking findings                                                                                                                                                                                                     | Disposition                                                                                                                                                                                                                                                      |
| ----- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Domain/UX, control-plane, runtime (GPT-6.1 Sol xhigh) | Default/explicit duplicate votes; atomic roster/settings; allocation failure scope; parent liveness; terminal cleanup recovery; full prepare intent; OCR full-inventory contract; exact failure/investigation routing | Incorporated in v2, with focused acceptance cases. Added immutable top-level producer profile, durable request attribution, mixed reuse/fresh serialization, and actual committed-entrypoint E2E. No new generic layer or native service change.                 |
| 2     | Domain/UX, control-plane, runtime (GPT-6.1 Sol xhigh) | User-observed roster CAS; pre-POST concurrency-group permits; exact per-reviewer investigation grant wire source                                                                                                      | Incorporated in v3. Also clarified descendant constraints, consumer-control cleanup reader, write-once deletion/retention, shared safety/integrity checks, version-specific bounds and full encoded checkout qualification. Round 1 blockers confirmed resolved. |
| 3     | Domain/UX, control-plane, runtime (GPT-6.1 Sol xhigh) | None remaining; earlier corrections verified                                                                                                                                                                          | Approved bounded implementation. Clarified ready-group admission to avoid head-of-line blocking. Freeze parser/env/selector/cleanup names between existing shared and runtime owners before export; this is contract coordination, not another framework.        |

## Evidence boundaries

Record the actual source revisions and checks. Unit tests, controlled provider
HTTP, actual PostgreSQL, browser behavior, live provider execution and production
activation are separate claims. Do not describe a fixture or unavailable gate
as a live end-to-end pass. Preserve existing credentials, user work and other
tasks' deployment changes.

## Initial implementation and local qualification, 2026-10-29

Both repositories use `feat/gateway-multi-reviewers`. The SaaS code candidate is
`baf8ec5911c35298c0a24789cced079165e5ede7`; the following documentation commit records
its qualification without changing product code. The final Action candidate
is `0da0202f8f36b9ceb055ec33f6e0b97b62a59025`, including current Action main
`298e7fca999edaee09b59d438a5694ed8961d394` and its lifecycle/restored-slot
rebinding correction. Version `1.0.219` is retained. The SaaS paired CI reference
selects this exact candidate. No production workflow channel or release tag
was changed.

The verified Action entrypoint SHA-256 is
`d31351ded62a44d5cee30effdd36ee31fba88ae4ca2824b1218c7d0898efde6f`.
The canonical reviewer-plan descriptor is
`sha256:f6a45d7039129a813690f5f769052d3ba078418eb123b0c0c710ef790d2919d6`.
The maintained generator and verifier accepted the exact committed Action,
canonical source handoff, profile descriptors and generated artifact.

### Delivered behavior and boundaries

The existing provider flow now edits an ordered roster with independent models
and settings. One write commits the full roster and execution settings against
the displayed versions. Repository inheritance carries the whole roster;
stale editors keep their draft. The editor reuses the existing model, account
and catalog status controls. Catalog failures retain active account metadata
and a same-account refresh action while model admission and Save remain closed.
Unknown model availability is reported as unknown; only an authoritative catalog
missing the model produces the unavailable-model warning.

V4 capture binds every reviewer, vote, selected model/settings and exact
allocation. Reviewers with identical captured account authority share one
finite allowance; distinct allocations may overlap within the configured
parallel limit. Request usage and local sessions remain reviewer-specific.
Preparation and cleanup remain allocation-specific, and existing aggregation
and App publication remain run-specific. The primary alone owns existing
non-voting auxiliary work. Existing V3 and singleton direct/Secrets behavior is
preserved. Mixed Gateway plus direct/Secrets execution remains a later phase
behind the explicit transport boundary.

### Independent implementation review findings

| Finding                                                                     | Correction and verification                                                                                                                                    |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A shared OCR context-tools plan reached a Codex child                       | Project capabilities into the eligible reviewer only; composed-runtime regressions and mixed-engine compiled E2E pass.                                         |
| Normal HTTP completion could be logged as unknown cancellation              | Abort the relay close listener only before `writableFinished`; real HTTP regression plus premature-disconnect coverage, 56 tests pass.                         |
| The joined E2E counted model calls without proving their allocation         | Enforce exact execution bearer, admission and request ownership in the controlled Gateway; assert reviewer/model to captured allocation to prepared execution. |
| Fake GitHub assigned bot authorship without validating mutation credentials | Preserve bridge headers and require an observed fixture App installation token for mutations; checkout read token is excluded.                                 |
| A failed catalog refresh removed metadata needed to retry                   | Separate active setup metadata from executable-model readiness; reuse the status/refresh control per reviewer and keep Save closed until recovery.             |
| Migration 152 was absent from maintained historical fixture catalogs        | Register only its exact SQL and complete checkout156 manifest; preserve all older reviewed SQL and managed92/historical96 boundaries.                          |
| Legacy committed bundles omitted new generated contract constants           | Regenerate both existing SaaS artifacts through their official helpers; hoisted/linked-store reproducibility and maintained artifact integrity pass.           |

### Qualification record

| Check                                  | Observed result                                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public Action feature suite            | 901 tests across 41 suites passed; after incoming main integration, 151 affected lifecycle/session tests and 21 artifact/metadata tests passed.                                                                    |
| Final paired Action/API/PostgreSQL E2E | 27/27 passed across six files on Action `0da0202f8f36b9ceb055ec33f6e0b97b62a59025`, in 200.82 seconds.                                                                                                             |
| Browser roster and catalog recovery    | 13 checks passed: save/reload, independent settings, complete inheritance, stale draft preservation, both themes at three widths, 200% text, authenticated HTTP 503 and retry with correct Save admission.         |
| PostgreSQL feature qualification       | Provider lifecycle 11/11 and allocation ownership/retention 3/3 passed on disposable PostgreSQL 17.10.                                                                                                             |
| Full default SaaS suite                | 12,594 passed, 765 existing opt-in skips, nine initial failures; see the complete disposition below.                                                                                                               |
| Full-suite source corrections          | All four non-Docker failures were repaired; combined three-file rerun passed 24/24. Affected frontend suites passed 109/109.                                                                                       |
| Types and protocol                     | All 54 package typecheck tasks and generated-web/spikes/one-shot/tooling checks passed; changed API/web native checks passed. Protocol regeneration passed under pinned pnpm 11.28.7 with clean generated sources. |
| Architecture                           | All stages passed unchanged: 593 domain/application files, Foundation full baseline and dependency policies, 23 memory cases, six statistics cases, and history boundary qualification.                            |
| Production and startup                 | API/worker dependency graph 48/48 passed; maintained web build generated 42 pages; production ESM rewrite processed 543 files; compiled API health and worker ONCE smoke passed.                                   |
| Source/artifact hygiene                | Full lint and formatting passed, affected files were rechecked, canonical release manifest verified, and both legacy generated artifact parity checks passed.                                                      |

The broad default run took 711.05 seconds and reported 871 passing files, seven
failing files and 86 existing opt-in skipped files. Its four source failures
were one checkout155/156 expectation, two catalog retry assertions and one
committed-bundle mismatch. Their focused repairs and combined rerun are recorded
above; the broad run itself remains an exit 1 result, not a reclassified pass.

The remaining five failures are in the four existing certified-fork PostgreSQL
suites (effect schema, archive repository, proof facts, history loader). Each
failed to start its required Docker fixture with
`managed_pg17_fixture_image:base_inspect:status=none:code=ENOENT:signal=none`.
No checks were skipped or weakened to hide that missing prerequisite. Required
hosted CI still needs to supply the pinned Docker fixture and pass those gates.

Architecture initially encountered generated negative fixtures reappearing
after successful deletion in the synchronized workspace. Read-only tracing
found no restoring path in the checker. The exact committed source and locked
dependencies passed the complete unchanged command from an isolated temporary
worktree; real source hashes, clean Git status and absence of leftover fixtures
were verified. Owned qualification worktrees were removed after recording the
results. No checker or architecture policy was relaxed.

The final paired scenarios each produced one parent execution and one aggregate
App publication. Shared-account reviewers used one preparation and observed
maximum concurrency 1; independent accounts used two preparations and observed
concurrency 2; mixed Codex/OCR used one captured allocation and concurrency 2.
The unavailable-primary case retained two required reviewer slots, accepted
only the healthy sibling and reported partial coverage rather than success.
Every request was checked against its exact captured reviewer/allocation, and
native closes matched the distinct prepared allocations without duplication.

### GitHub integration after current main changes

The user selected the connected GitHub plugin after the CLI credential path
was unavailable. The plugin authenticated the owner `777genius`. New source
commits were independently checked for that linked user, accepted owner name
and exact canonical author and committer email before branch publication.
Updates use the observed branch head as a lease and do not force-push.

The SaaS source commit is `c4e0834d30eb8f076c6996a3b6093cef06af7843`; its complete
Git tree is identical to local integration `66d944a9aa6813b572011b4938daccd89f3f7741`.
It includes main `89ce21cccbd5e979baf46450ecb8bb5b1b599e90`, preserving durable
cleanup targets and provider-dialog autofocus. Integration verification passed
121 focused tests, three affected typechecks, targeted lint and formatting,
and the native PostgreSQL cleanup/history test with all 156 migrations and
latest migration 152. The only merge conflict was the deployment index; all
three existing task records were retained. The incoming PostgreSQL test's
strict migration count/latest expectation was updated for the feature migration.

The Action candidate is `7679a6069e8b37d18b2b555172eea5fcb59d2511`, version 1.0.220.
Its complete Git tree matches local `dbd50f4b90852d0a2cbc288075a075fee26637dc` and
includes current main `2b9b7f8c438b076b6e06c6e14f9ac8e87f1a25b6`. That integration
passed 334 focused tests and 13 committed-artifact tests, types, full lint and
formatting, domain checks and a reproducible canonical rebuild. Only the
generated source map needed merge resolution, through that build.

The maintained exporter then regenerated the Action handoff from the remotely
available SaaS source and Action main base. Of 61 generated files, only the
handoff's two provenance fields changed. Protocol and runtime bytes did not.
Handoff and protocol metadata tests passed 12/12, and the maintained release
generator and source verifier accepted the exact published Action commit.
Its runtime SHA-256 is
`d763d505805c098cc561dfc38e80a4540c4da575928288a5429120cd2d74f6ae`;
the handoff SHA-256 is
`1f2f11c10efac7f894268a60ea63d6d17fe2afa706cf980d3a4341d98aaa8fdd`.
The reviewer-plan descriptor is unchanged. The final SaaS integration selects
that exact Action commit in paired CI. Local qualification history is preserved
on backup branches; publication did not rewrite existing remote history.

The first paired rerun against the published Action passed 20/27 and exposed
seven lifecycle fixture failures: synthetic GraphQL comments omitted the newly
required `publishedAt` and `lastEditedAt` fields. The production inventory
correctly treated their edit state as unknown and excluded them from automatic
revalidation. One shared fixture now supplies a complete unedited publication
observation at both test boundaries. The strict packet and receipt assertions
remain unchanged, with an added assertion that all four intended targets are
explicitly unedited. The focused lifecycle rerun passed 7/7.
The complete paired Action/API/PostgreSQL rerun then passed all 27 tests across
six files in 220.66 seconds on the published Action candidate, including the
four compiled multi-reviewer cases. Action hosted CI run
[40847630411](https://github.com/777genius/review-router/actions/runs/40847630411)
passed all 17 steps, including the full managed OCR suite, native MCP, build and
committed artifact parity; Kimi native qualification also passed.

### Integration and evidence limits

Required hosted CI and the maintained owner merge checks apply to the final
published heads; the linked PRs record their live result and merge state.
Current main's 14-job CI passed, proving runner and Docker availability; it is
not qualification of this feature head. No credential substitution,
required-check bypass or protected-branch write was used.

The browser uses the real app/server actions and disposable SQL with a controlled
Gateway model-catalog peer. The paired runtime uses the compiled Action,
production API handlers, actual PostgreSQL and signed fixture OIDC against
controlled GitHub/Gateway/provider peers. These establish source behavior;
live inference, a live GitHub installation and deployed-environment canaries
remain separate release evidence. Follow the deployment task before activation.

### Final cancellation review (2026-10-29)

The final source review found and corrected three related runtime boundaries:

- Stopped Action reviewer lanes no longer wait for a retry or acquire another
  invocation lease. Queued admission checks the lane again, while an admission
  already in flight still releases its acquired lease. Independent allocations
  remain eligible to complete.
- Legacy V3 completed closes revoke their parent authorization. V4 normal
  cleanup preserves publication authority; cancellation and deadline termination
  still revoke or expire it when joining an existing normal cleanup.
- Local requests stop before an awaited authority write. A failed parent write
  retains bounded session evidence, denies unstarted sibling allocations, and
  cannot be forgotten by a later normal cleanup retry. Native close identity and
  its first reason remain stable.

The Action orchestration suite passed 122/122, including five new regressions
that fail against the preceding source. The Gateway relay suite passed 63/63,
including seven cancellation, revocation-failure and retry regressions. Both
changed runtimes passed typechecking; focused lint and formatting passed.
Independent review of the final failure and cleanup paths found no remaining
blocking issue.

Two PostgreSQL fixtures were also corrected without relaxing their contracts:
the historical SQL079 producer fixture omits the later reviewer-plan field,
and the current Gateway configuration fixture asserts all 156 migrations,
including the exact 19-entry tail through migration 152. The official hosted
PostgreSQL jobs and complete paired Action/API suite remain required checks of
the final published pair; their exact-head results are recorded on PRs #738
and #351. No new migration, product flag or production activation was added.

The final paired CI candidate is Action `de11bc35438ef3b49d6d9228aab507f47156565f`.
Its runtime entrypoint SHA-256 is
`28cf7069d613b31d15a626e0c937e0e0c77dbe5e971c1d1d346e78566f8207d3`.
The generated canonical handoff remains unchanged at the published source above.
