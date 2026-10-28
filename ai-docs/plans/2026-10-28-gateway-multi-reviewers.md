# Several Gateway reviewers

Status: implementation plan v1, ready for independent review round 1.
Implementation has not started. Draft: [ReviewRouter #738](https://github.com/777genius/review-router-ai/pull/738).

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

| Responsibility | Existing owner | Change |
| --- | --- | --- |
| Stored selection and inheritance | `features/review-config`, stored schema 4 and runtime schema 3 | Plural use cases and complete view models; keep the schemas |
| Credential/profile identity | `WorkspaceProviderProfile` and profile repository | Reuse binding/profile/model identity and atomic draft resolution |
| Admission and private execution authority | `features/review-run-control`, API capture and Gateway adapters | Versioned reviewer capture and bounded Gateway allocations |
| Durable slot/lease/evidence state | `features/review-executions` | Reuse exact vote-hash work slots and required coverage |
| Native inference | Existing Gateway service and native authority | No changes to their protocol or custody; reuse finite execution allowances |
| Runtime planning and scheduling | Public runtime `review-orchestration` | Reviewer-aware adapters and bounded parallel inference |
| Consensus and publication | Existing projection/consensus and SaaS publication ledger | Count distinct vote identities; one finalizer/publisher |

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
Default badges, list summaries, readiness and row-specific edit/remove actions
must represent every selection. Removing one reviewer cannot clear the roster.

The first reviewer is the captured primary for existing non-voting PR description
and lifecycle tasks. This reuses today's ordering rule; no new primary selector,
weights, drag-and-drop or per-reviewer billing UI is added.

Reuse the existing Max parallel providers and Inline agreement controls in the
roster editing flow. Preserve saved values. Adding a reviewer does not silently
raise parallelism; shrinking the roster uses the existing fit-to-count policy.
The concurrency acceptance scenario explicitly saves two reviewers and a limit
of two. All reviewers remain required by default; preserve existing requiredness
when editing a saved selection.

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
captured reviewer identity. The workflow cannot nominate another model, account,
engine or vote. Duplicate hashes and reviewer IDs fail closed. Provider kind
remains engine metadata, never a reviewer key. Preserve the configured roster
order and bind it into the existing policy/plan digest.

Snapshot parsing, identity and reviewer resolution belong to
`features/review-run-control/domain`. Authorization and preparation ports use
these primitive domain values. SDK types and Prisma remain in their adapters.
Version 4 is bounded to 16 reviewers and a finite 128 KiB private envelope;
maximum-shape tests must qualify the bound without widening unrelated clients.

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

Add one write-once child relation for version 4 selected Gateway executions,
keyed by authorization ID and allocation ID. Preserve the old parent field and
its constraints for version 3. An additive migration independently validates
the child against the exact captured allocation, account, epoch, deadline and
active parent; immutable fields cannot be overwritten. Keep the existing lock
order, and lock distinct bindings deterministically. Allocate the migration
number against current main immediately before implementation to avoid other
tasks' migration collisions.

Preparation uses one new versioned operation/invocation/attempt namespace per
allocation. Concurrent reviewers share the same preparation promise/result;
restart restores the same operation. Unknown preparation, failed attachment and
cleanup follow the existing no-replay/reconciliation rules. No inference is
replayed and no fresh allowance is minted to recover an ambiguous result.

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

## Public runtime plan and compatibility

One safe versioned reviewer-plan schema/parser lives with existing shared
agent/runtime contracts in `packages/shared`; the canonical generator/exporter
delivers it to the public Action. Do not maintain a second hand-written parser
or edit generated output manually. Export only after committing the source.

The public plan contains reviewer ID, provider index, vote hash, selected safe
model/settings, captured engine profile/digest, requiredness, primary reviewer
and effective parallel/agreement limits. It contains no upstream credential,
private account ref, selected execution capability or server allowance.
Bound the public plan to 64 KiB and validate it before any provider effect.

An explicit immutable producer contract capability proves that a producer can
consume reviewer-plan v1. It is a compatibility fact in the existing signed
producer/agent manifest, not an environment flag or rollout toggle. Deny new
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

Reuse stable batch×reviewer work planning. Budget the complete fanout against
the existing maximum slot count before dispatch. Preserve complete reviewer
groups and truthful uncovered-file coverage. Reject a plan that cannot fit
even one complete required group. Optional description/lifecycle work uses the
captured primary and existing remaining-slot rules; it does not multiply.

Add bounded scheduling within the existing orchestration use case. At most the
configured reviewer parallelism runs, and one reviewer's batches are serial
because its transport permits one request at a time. Gateway's granted/account
limits remain independently authoritative. Native execution may overlap; one
coordinator owns current execution state and serializes version-sensitive
adoption/supersession/finalization. Out-of-order replies cannot lower the known
stream version. Restore/reconcile once all workers settle before finalization.

Parent cancellation, supersession or a run-wide authority failure stops new work,
aborts all children and drains them to settlement before release/finalization.
Reviewer-specific denial or failure settles that reviewer without poisoning
another reviewer's transport or globally revoking the run. Unknown/paid dispatch
remains fenced; the existing narrowly proven unpaid-saturation behavior stays.

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
  model calls with saved parallelism two; total requests consume one allowance.
- Two bindings: independent credentials/capabilities; wrong reviewer/account,
  stale binding epoch, removed model and mutable post-admission policy denied.
- Exact duplicate selections denied; 1/16 accepted and 0/17 denied; bulk draft
  resolution, full inheritance and removing one reviewer preserve the rest.
- Out-of-order completion, shared budget exhaustion, one required failure,
  optional failure, deadline, cancellation and supersession all settle truthfully.
- Preparation/attachment restart, uncertain dispatch and duplicate finalize do
  not create new inference or publication effects.
- Same model through distinct bindings and different existing engine profiles
  retain independent vote identities and appropriate per-engine capabilities.
- Existing singleton Gateway and approved direct/Secrets flows remain valid.

Use existing real PostgreSQL admission/migration and HTTP relay fixtures, the
paired Action/SaaS harness, and the existing browser provider-settings harness.
The execution E2E must exercise the actual composed API and compiled public
runtime with two controlled provider responses, observable overlap and one
aggregate publication boundary. A unit-level fake orchestrator is insufficient.
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
- [ ] Review round 1 and plan corrections.
- [ ] Review round 2 and plan corrections.
- [ ] Review round 3 and final plan.
- [ ] Implementation in dependency-ordered commits, pushed after each commit.
- [ ] Focused behavior, protocol/architecture and required repository checks.
- [ ] Browser and joined execution E2E on disposable resources.
- [ ] Independent code review, fixes and exact-head verification.
- [ ] Merge through the maintained owner PR guard.

Review ledger (findings and dispositions will be appended after each round):

| Round | Independent critics | Blocking findings | Disposition |
| --- | --- | --- | --- |
| 1 | Pending | Pending | Pending |
| 2 | Pending | Pending | Pending |
| 3 | Pending | Pending | Pending |

## Evidence boundaries

Record the actual source revisions and checks. Unit tests, controlled provider
HTTP, actual PostgreSQL, browser behavior, live provider execution and production
activation are separate claims. Do not describe a fixture or unavailable gate
as a live end-to-end pass. Preserve existing credentials, user work and other
tasks' deployment changes.
