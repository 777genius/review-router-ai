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

## Original qualified source candidate

The canonical SaaS source is
`1a21c33f39ff42fa8c640d9cfd4980f8ff88f8e7`. It preserves the multi-reviewer
implementation, the reviewed cancellation corrections and current main
`8ea78b9df1398e64fce917eecdc18d95e52d9e9f`, including source-to-browser history
qualification. The final SaaS integration advances the paired CI pin and this
evidence without changing the canonical wire source.

The final published Action candidate is
`99776cd79a9d783cd3d3ab2ea349dd61096a992e` (version 1.0.220). It includes current main
`8a6bb7395556ddabbda4b8275bc9e2de6fea4f8e`, retaining managed conversations and
shared frozen memory alongside independent Gateway reviewers. The SaaS paired
CI pin selects this exact published candidate. Candidate identities are:

- Runtime entrypoint SHA-256: `429f473766dabd5870c9b52933b2a4905648aaf2f5fd8bea3f8b9230a978669a`.
- Canonical handoff SHA-256: `ef4f97bc59138460fab379e4fee4900d56bc3cf69f70b0b01a78f50468eb9500`.
- Reviewer-plan version 1 descriptor: `sha256:f6a45d7039129a813690f5f769052d3ba078418eb123b0c0c710ef790d2919d6`.
- Migration 152 SQL SHA-256: `013e9b1917940ed3a796f8df6fa85a0c9c0cc5a4e76a7b19841911f3ea24bd6d`.
- Complete checkout156 migration manifest: `sha256:ef2c303008c8edac0df3372f725f374ba417042a6707daf25b69c87897bd1e38`.

The preceding published pair passed 27/27 scenarios, including all four compiled
multi-reviewer cases. Cancellation review passed 122/122 Action orchestration
tests and 63/63 Gateway relay tests. After integrating current main, the eight
affected Action suites passed 402/402, including regressions for task-specific
memory and surviving reviewer lanes. Canonical handoff tests passed 23/23, and
double generation changed only the expected conversation wire artifact.
Typechecks, focused lint/format and independent conflict reviews passed.
The exact final pair must pass the maintained hosted CI gates; their current
results and merge state are recorded on the linked PRs.

The existing browser qualification passed 13 checks, including catalog
failure/retry and fail-closed Save. Production builds, compiled startup,
protocol and unchanged architecture gates passed. The implementation plan
retains the detailed qualification ledger and its source boundaries.

The source is published through the owner's connected GitHub plugin. Complete
source trees and accepted author/committer identities are checked before leased,
non-force branch updates. The handoff is regenerated through the maintained
exporter from the actual published canonical commit and Action base. It retains
the V4 artifacts and adds the immutable conversation wire file already used by
Action main. Only that wire source and its canonical export were carried from
SaaS `157eed60e97ecfc31d9ceaea8c8c989eb9e9e3be`; no conversation runtime or
activation is included in this task.

Hosted CI includes the five Docker-backed certified-fork PostgreSQL cases.
The historical SQL079 producer fixture omits the later reviewer-plan field,
and its original configuration fixture verified the then-current 156 migrations through152.
Fresh PostgreSQL and compiled paired-E2E qualification remain required
source-integration checks before selecting a release.

After merge, reconcile the actual merged source revisions and regenerate/verify
the release manifest for the exact candidate chosen by the release procedure.
A source candidate does not itself register a producer or change an installed
workflow channel.

## Current unified OCR integration

Main `2c9310337a0f4820f6f5b2d74911e19bc06ff83d` adds the existing unified OCR
implementation and migration154 to the preserved V4/migration152 source.
The combined inventory has 157 migrations. Its exact paired Action is now
`925df40c6c5806fe2b6673c5f807fdc6abf2fe40` (A4), selected by the maintained CI.
The original candidate and counts above remain historical qualification for
their own inputs. Qualify each selected integrated SaaS head with A4 and the
manifest-verified managed OCR through the maintained paired/browser gates.

Coordinate the [Unified OCR deployment task](2026-10-29-unified-ocr.md) and the
[account-model completion](2026-10-28-model-catalog.md). Apply every missing
required migration, including152/154, before starting dependent writers, while
preserving installed history and original admitted-run authority. V4 reviewers
retain their individual allocation and engine/model settings; they do not borrow
a singleton V2 model-dispatch capability. Codex and OCR may be combined within
a Gateway-only roster. Mixed Gateway/direct transport remains unsupported.
No staging or production adoption is established by this source integration.

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
   preflight. Apply the missing checked-in migrations with the maintained release
   migration path before starting dependent writers or child allocation rows. Preserve
   historical migration checksums.
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
- Reviewers with the same captured Gateway authority share its finite allowance,
  including the account, exact binding, profile, authorization epoch and limits.
  Different captured authorities retain separate allocations; their work may
  overlap within the configured global cap.
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

Follow the existing release rollback procedure. Preserve migrations152/154 and
their retained allocation, model-dispatch and cleanup evidence. Do not roll back to an API that cannot read active V4
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
