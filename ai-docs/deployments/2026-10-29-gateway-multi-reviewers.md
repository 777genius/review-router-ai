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

The locally qualified SaaS code candidate is
`baf8ec5911c35298c0a24789cced079165e5ede7`. A following documentation-only commit
records the qualification. The local Action candidate is
`0da0202f8f36b9ceb055ec33f6e0b97b62a59025` (version 1.0.219), including
current main's lifecycle/restored-slot rebinding correction. The SaaS paired
CI pin selects that commit. The canonical release generator and verifier
accepted the candidate with:

- Runtime entrypoint SHA-256: `d31351ded62a44d5cee30effdd36ee31fba88ae4ca2824b1218c7d0898efde6f`.
- Reviewer-plan version 1 descriptor: `sha256:f6a45d7039129a813690f5f769052d3ba078418eb123b0c0c710ef790d2919d6`.
- Migration 152 SQL SHA-256: `013e9b1917940ed3a796f8df6fa85a0c9c0cc5a4e76a7b19841911f3ea24bd6d`.
- Complete checkout156 migration manifest: `sha256:ef2c303008c8edac0df3372f725f374ba417042a6707daf25b69c87897bd1e38`.

The final paired source qualification passed 27/27 scenarios, including all four
compiled multi-reviewer cases. Browser qualification passed 13 checks, including
catalog failure/retry and fail-closed Save. Production builds, compiled startup,
protocol and unchanged architecture gates passed. The implementation plan has
the detailed review and validation ledger.

Source integration remains pending: this local environment lacks GitHub CLI
authentication, so the final commits have not been pushed or merged. The broad
unit run also requires a CI runner with Docker to complete five existing
certified-fork PostgreSQL cases; all four source failures found in that run were
repaired and passed their combined targeted rerun. These are source-integration
gates, not completed deployment evidence. Resolve them before selecting a release.

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
