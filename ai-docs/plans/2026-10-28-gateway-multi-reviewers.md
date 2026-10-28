# Several Gateway reviewers

Status: research and plan review. Implementation has not started.

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

## Research owners

Three GPT-6.1 Sol/xhigh researchers inspect the existing domain/frontend,
control-plane authority and public runtime independently. Their findings must
identify exact source owners, current cardinality assumptions, protected wire
contracts and the smallest coherent change before implementation starts.

The first observations require explicit decisions about reviewer/vote identity,
private runtime snapshot evolution, per-reviewer Gateway execution custody and
serial durable event commits around parallel inference. Merely removing a
single-provider guard is insufficient.

## Plan review process

The implementation plan will include exact owners/files, invariants, failure
semantics, compatibility, non-goals and meaningful verification gates. Perform
three rounds with multiple independent critics; record findings and concrete
dispositions after each round. A review round is not complete until its
blocking findings are addressed or the delivery scope is explicitly reduced.

- [ ] Research and first implementation plan.
- [ ] Review round 1 and plan corrections.
- [ ] Review round 2 and plan corrections.
- [ ] Review round 3 and final plan.
- [ ] Implementation in dependency-ordered commits, pushed after each commit.
- [ ] Focused behavior, protocol/architecture and required repository checks.
- [ ] Browser and joined execution E2E on disposable resources.
- [ ] Independent code review, fixes and exact-head verification.
- [ ] Merge through the maintained owner PR guard.

## Evidence boundaries

Record the actual source revisions and checks. Unit tests, controlled provider
HTTP, actual PostgreSQL, browser behavior, live provider execution and production
activation are separate claims. Do not describe a fixture or unavailable gate
as a live end-to-end pass. Preserve existing credentials, user work and other
tasks' deployment changes.
