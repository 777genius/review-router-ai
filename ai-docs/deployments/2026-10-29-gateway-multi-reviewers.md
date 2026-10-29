# Several Gateway reviewers: deployment

- Task ID: `2026-10-29-gateway-multi-reviewers`.
- Goal: configure and execute several Gateway reviewers with independent models,
  bounded shared account allowances, complete coverage and one publication.
- Affected targets: database, API, worker, web and the public ReviewRouter Action.
- Implementation: [SaaS #738](https://github.com/777genius/review-router-ai/pull/738)
  and [Action #351](https://github.com/777genius/review-router/pull/351).
- Implementation reference: branch `feat/gateway-multi-reviewers` in both
  repositories. Resolve the final merged commits and qualified Action artifact
  before selecting a release; intermediate implementation checkpoints do not
  identify an installed release.
- Dependencies: the existing Account Gateway deployment and authorized consumer
  control/run access credentials; no new native service protocol or credentials.
- Last updated: `2026-10-29`.

## Environment status

| Environment / target | Status    | Actual deployed version | Last verified (UTC) | Next step                                                                   |
| -------------------- | --------- | ----------------------- | ------------------- | --------------------------------------------------------------------------- |
| staging              | `pending` | Not verified            | Not verified        | Reconcile installed versions and select the exact qualified paired release. |
| production           | `pending` | Not verified            | Not verified        | Complete staging verification, then use the authorized release procedure.   |

This task records source implementation and local qualification. It does not
claim a deployment or authorize workflow channel promotion. The separate
account-catalog deployment is not included in this task.

## Qualified source candidate

The published canonical SaaS source is
`c4e0834d30eb8f076c6996a3b6093cef06af7843`. Its Git tree exactly matches the
qualified local integration `66d944a9aa6813b572011b4938daccd89f3f7741`, including
main `89ce21cccbd5e979baf46450ecb8bb5b1b599e90` and its durable cleanup correction.
The final SaaS integration also updates the paired CI pin, shared publication
timestamp fixtures and this evidence.
The final published Action candidate is
`de11bc35438ef3b49d6d9228aab507f47156565f` (version 1.0.220). It retains main
`2b9b7f8c438b076b6e06c6e14f9ac8e87f1a25b6` and adds the reviewed cancellation
correction. The SaaS paired CI pin selects this exact published candidate.
The canonical handoff is unchanged; candidate identities are:

- Runtime entrypoint SHA-256: `28cf7069d613b31d15a626e0c937e0e0c77dbe5e971c1d1d346e78566f8207d3`.
- Canonical handoff SHA-256: `1f2f11c10efac7f894268a60ea63d6d17fe2afa706cf980d3a4341d98aaa8fdd`.
- Reviewer-plan version 1 descriptor: `sha256:f6a45d7039129a813690f5f769052d3ba078418eb123b0c0c710ef790d2919d6`.
- Migration 152 SQL SHA-256: `013e9b1917940ed3a796f8df6fa85a0c9c0cc5a4e76a7b19841911f3ea24bd6d`.
- Complete checkout156 migration manifest: `sha256:ef2c303008c8edac0df3372f725f374ba417042a6707daf25b69c87897bd1e38`.

The preceding published pair passed 27/27 scenarios, including all four compiled
multi-reviewer cases. The final cancellation correction passed 122/122 Action
orchestration tests and 63/63 Gateway relay tests, with both runtime typechecks
passing. The exact final pair must pass the maintained hosted CI gates. Browser qualification passed 13 checks, including
catalog failure/retry and fail-closed Save. Production builds, compiled startup,
protocol and unchanged architecture gates passed. The implementation plan has
the detailed review and validation ledger.

The source is published through the owner's connected GitHub plugin. Source trees
and canonical author/committer identities were checked before leased, non-force
branch updates. The handoff was regenerated with the maintained exporter from
the remotely available source and Action base; no generated fields were edited
by hand. Required CI and guarded merge are source-integration gates; their
current result and merge state are recorded on the linked PRs.

Hosted CI includes the five Docker-backed certified-fork PostgreSQL cases.
The historical SQL079 producer fixture omits the later reviewer-plan field,
and the current configuration fixture verifies all 156 migrations through152.
The plan records the completed cancellation reviews and local regression proof;
the linked PRs record fresh PostgreSQL and compiled paired-E2E qualification.
These remain required source-integration checks before selecting a release.

After merge, reconcile the actual merged source revisions and regenerate/verify
the release manifest for the exact candidate chosen by the release procedure.
A local source candidate does not itself register a producer or change an
installed workflow channel.

## Applicability and prerequisites

Use the [release source of truth](../operations/07-environments-and-release-management.md).
Inspect the installed-to-target schema and source range and reconcile every
applicable deployment task before starting.

The release must contain migration
`000152_review_run_gateway_allocations`, its matching Prisma client, the V4
runtime capture/relay implementation, and the generated reviewer plan parser
in the public Action. Generate and verify the public release manifest through
the existing canonical export/handoff tools. Its immutable `reviewerPlanProfile`
must match the descriptor bound to that exact Action artifact. This is a
compatibility check, not a feature flag; no new feature flag is required.

Preserve the existing caller workflow ABI and GitHub App publication. Existing
singleton V3 snapshots remain valid and use their original identities. An older
producer without the reviewer plan capability must never receive a V4 plan.

## Ordered rollout

1. Take the usual verified database backup and complete the release migration
   preflight. Apply the checked-in migration with the maintained release
   migration path before starting code that writes child allocation rows. The
   migration is additive; do not edit historical migration checksums.
2. Deploy the matching API and worker code. Verify V3 recovery and the new
   allocation attachment, epoch fencing and terminal cleanup read paths. Verify
   the existing consumer-control credential can read a preparation operation;
   the run-control credential must not be used for that readback.
3. Build, verify and register the exact public Action producer manifest using
   the existing release workflow. Complete the compatibility checks and the
   disposable repository canary before any workflow channel promotion. Do not
   promote an unregistered or unqualified artifact.
4. Deploy the web editor with the compatible backend and producer available.
   Existing saved parallelism is preserved; the canary must explicitly save two
   reviewers and a parallelism limit of two.
5. Verify the scenarios below in each environment and record actual versions,
   timestamps and durable evidence before widening the rollout.

The future mixed Gateway plus GitHub Secrets/direct execution path remains out
of scope. Do not enable it through an environment override or a legacy workflow.

## Verification and completion

- Save two different models, reload and edit them independently. Verify complete
  workspace inheritance and repository replacement, including a stale-editor
  conflict that preserves the unsaved draft.
- Verify one parent authorization, checkout, execution and aggregate GitHub App
  publication. Each model must retain its own reviewer/vote identity and settings.
- Two models sharing an account must share the captured finite allowance. Two
  independent account allocations may overlap within the configured global cap.
- Revoke or disable one connection after admission: its reviewer remains in
  coverage as unavailable while a healthy independent reviewer completes. The
  aggregate must remain incomplete when a required review failed.
- Verify cancellation, deadline and stale-revision cleanup. Original attached
  allocations must close or retain retryable cleanup evidence; a cleanup retry
  must never create an execution whose original preparation does not exist.
- Check usage ownership, absence of provider credentials in CI, and one final
  publication authored by the configured GitHub App bot.

Local unit, PostgreSQL and controlled paired E2E evidence establishes source
readiness. A live deployment requires the environment-specific canary above;
record its actual artifact and provider results separately.

## Retry, partial completion, and rollback

Before retrying, inspect migration state, producer registration, the actual
fleet versions and any retained allocation cleanup rows. Retry the same
captured preparation/cleanup identity using the maintained operation readback.
Do not reset or reinsert immutable allocation rows to obtain fresh allowance.

Follow the existing release rollback procedure. Preserve migration 152 and its
retained cleanup evidence. Do not roll back to an API that cannot read active V4
snapshots: drain/complete those runs with the compatible API first, or roll
forward to a corrected compatible build. An older Action does not support
saved multi-reviewer execution; coordinate any producer rollback with explicit
configuration restoration through the supported UI, without silently deleting
reviewers or lowering agreement requirements.

## Related links

- [Approved scope and three review rounds](../plans/2026-10-28-gateway-multi-reviewers.md).
- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).
- [SaaS PR #738](https://github.com/777genius/review-router-ai/pull/738).
- [Action PR #351](https://github.com/777genius/review-router/pull/351).

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version | Step and result                                     | Evidence           | Next action                                       |
| ------------ | -------------------- | ---------- | -------------- | --------------------------------------------------- | ------------------ | ------------------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified   | Source implementation and local qualification only. | Implementation PRs | Select and execute the authorized paired rollout. |
