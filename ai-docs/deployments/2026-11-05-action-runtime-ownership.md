# Action runtime ownership refactor

## Current code reconciliation (2026-11-14)

PR #815 is merged. Its private code ancestry is included in installed d2f and retained signed 234/source Ebe, as reconciled in the [current registry baseline](README.md#current-coordinated-rollout-reconciliation-2026-11-14). Earlier pending-source/no-installation statements below describe historical delivery checkpoints. There is no new schema/configuration/activation step or reason to redeploy this behavior-preserving code merely to clear a stale task status. This is **installed ordinary code**, not a claim of feature activation, independent live qualification or public Action artifact proof inferred from ancestry. Preserve separate semantic Memory, public distribution, self-hosted and GitLab acceptance boundaries.

- Task ID: `2026-11-05-action-runtime-ownership`
- Goal: preserve existing GitHub Action reviews while assigning credential-safe checkout, HTTP retries, subprocess custody/redaction, bundle verification, provider environment policy and workflow attestation to bounded owners.
- Affected targets: `777genius/review-router-ai` Action source and checked-in `action-dist/index.cjs`; paired public Action distribution `777genius/review-router` **only if and when a release is separately authorized**.
- Implementation PR: [ReviewRouter #815](https://github.com/777genius/review-router-ai/pull/815) (Draft candidate).
- Implementation reference: PR HEAD at delivery; initial candidate `e0e06ae6ce22b91bd84d108c103cea7fe0639f0e` is source provenance, not deployed evidence.
- Dependencies: verified deterministic Action artifact, release approval and compatible paired Action release under the [release process](../operations/07-environments-and-release-management.md).
- Last updated: 2026-11-14.

## Environment status

| Environment / target               | Status    | Actual deployed version / image               | Last verified (UTC)          | Evidence / next step                                                          |
| ---------------------------------- | --------- | --------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| staging                            | `pending` | Not verified                                  | Not verified                 | No deployment requested; confirm release selection and target before rollout. |
| production / public Action channel | `pending` | Existing installed revisions remain unchanged | Not verified for this change | Do not move Action refs, tags or workflow-v1 based on a Draft PR.             |

`pending` records absent proof for this task; it does not assert that a version was observed missing.

## Applicability and prerequisites

This is a source and Action bundle refactor. No Prisma migration, credential rotation, new feature flag, protocol ABI, activation or data conversion is introduced.

Before any _separately authorized_ rollout, verify the exact merged source, the bundle rebuilt using the pinned Node/pnpm toolchain, and the release gate evidence under the documented release process. Confirm whether the paired public Action artifact is part of that particular release. Existing immutable Action tags and installed user workflows must not be modified by this task.

## Ordered rollout

1. Preflight: reconcile this task against the selected exact source SHA and the current public Action channel. Run the required Action source/bundle parity, TypeScript, architecture, security tests and substantive CI/E2E. An aggregated green Draft gate allowing skips is insufficient.
2. If release is authorized later: follow the established [environment and release procedure](../operations/07-environments-and-release-management.md). Deploy or distribute only the approved exact source/bundle pair. There is no standalone migration or activation step.
3. After rollout: verify the installed image/revision and paired Action SHA, one authorized disposable GitHub App-first review flow, comment authorship, inline findings, and redacted logs. Record immutable references and outcomes separately for staging/production.

## Verification and completion

- `action-dist/index.cjs` is byte-identical to a deterministic build, including clean linked/hoisted stores; `pnpm action:artifact:check` passes.
- Root lint, formatting, TypeScript, Action test suite, architecture and relevant integration/DB/self-hosted E2E pass on the exact promoted SHA.
- Credential-bearing env keys never reach unselected runtimes; split process log chunks redact tokens; bounded process termination and HTTP retry/failover are exercised.
- Release/rollout verified with actual image/Action refs, timestamps and checks. A merged PR or green CI alone does not mean `deployed`.

## Retry, partial completion and rollback

Re-read current channel, source SHA and any partially executed release step before resuming. Never replay an uncertain external GitHub publication or push mutable Action refs without the maintained release gate. If an approved rollout regresses, restore the previously verified immutable Action/runtime ref per the release runbook; no DB rollback or data conversion applies here. Preserve audit and review evidence.

## Related links

- [Draft implementation PR #815](https://github.com/777genius/review-router-ai/pull/815)
- [Bounded refactor plan](../plans/2026-11-05-action-runtime-ownership-refactor.md)
- [Release procedure](../operations/07-environments-and-release-management.md)
- [Quality gates](../operations/03-quality-gates.md)

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result                                | Evidence                   | Next action                                          |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------------------------------------- | -------------------------- | ---------------------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | No deploy or release authorized for this Draft refactor | PR #815 source and CI only | Complete exact-head CI, then await release selection |
