# Account model catalog: coordinated deployment

- Task ID: `2026-10-28-model-catalog`.
- Goal: discover and execute authorized Codex/OpenRouter account models without a feature flag.
- Affected services: sub2api native, Account Gateway, ReviewRouter Web/API/worker.
- Implementation: [ReviewRouter catalog](https://github.com/777genius/review-router-ai/commit/b2f40048559a841f41b6756c8eac2ed90b04c2d4) plus the no-flag follow-up containing this record.
- Dependencies: native [b3f012af5a54f1ffcccc1d34987a48120d1c39aa](https://github.com/agent-teams-ai/sub2api/commit/b3f012af5a54f1ffcccc1d34987a48120d1c39aa), Gateway [e754d67656a2ac7812024d121d1a73ce3e587e6b](https://github.com/agent-teams-ai/account-gateway/commit/e754d67656a2ac7812024d121d1a73ce3e587e6b), and their qualified catalog contract.
- Last updated: 2026-10-28.

## Environment status

| Environment | Status        | Actual deployed version / image      | Last verified (UTC) | Evidence / next step                                                                             |
| ----------- | ------------- | ------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------ |
| staging     | `pending`     | Not verified                         | Not verified        | Reconcile native/Gateway and application versions; follow the ordered rollout.                   |
| production  | `in_progress` | `4dd75ecf` / image prefix `3d2fd2df` | 2026-10-28 23:52    | Fleet/native/catalog active; real review running. Await publication, rerun and isolation checks. |

`pending` records missing deployment evidence, not observed absence. Implementation checks do not prove production readiness.

## Production progress: 2026-10-28

The owner explicitly approved a manual deployment with targeted checks without
waiting for full CI/rehearsal. This resolves the earlier pre-deploy gate; it
does not establish completed deployment. The selected runtime source remains
[`4dd75ecfe3d22701ba741f451b046f0b5e440231`](https://github.com/777genius/review-router-ai/commit/4dd75ecfe3d22701ba741f451b046f0b5e440231).
Subsequent documentation-only commits do not change that selected source.
The integration preserves the current production Skills/Context tools repair
checkpoint `1e3a5379ea6268692ed7f0545c9ebd0c9049c5b9` (#735), main `f2f7ae327`
(including #733 and #730), and the no-flag #739 work. It does not include #732.

The application fleet was switched at 20:19 UTC to source `4dd75ecf` and
image `sha256:3d2fd2dfd5ff4c4b4c02cd513aeaecd450d6508b0fd1d04c01b7c80516891939`.
Web/API/worker/scan use the same image; public status and fresh runtime generation
canary passed. Prisma151 and canonical runtime ACL grants passed, preserving the
prior 158 ledger rows (159 afterwards). Encrypted backup `20261028-203841F`
completed before migration. History capture is enabled on all writers; explicit
activation passed at `2026-10-28T20:22:19.946Z`.

Native migration ledger is 314 with all target checksums verified and the prior
305 rows preserved. Gateway `e754d676` is active. The first native version
`b3f012af` exposed a real OpenRouter catalog regression: bounded service selector
IDs beginning with `~` rejected the whole public payload. The focused fix
[`82f5c41a`](https://github.com/agent-teams-ai/sub2api/pull/74) passed 29 catalog
cases, 18 guard cases and the actual 457-row public payload test. Its binary
SHA-256 is `8658a2f8c09c9fffed994ca7b3f9831197bd02a33df77a33ef8759ae02f3014a`.

The native-only update completed at 23:45 UTC without rerunning migrations or
changing the Gateway unit/bootstrap. Both account catalogs returned 438 models.
Kernel histories and native accounts were preserved. Native admission was then
restored; both hosts return the expected unauthenticated 401 on execution and
run-access routes. Operator receipts are retained in the protected production
release directory `native-selectorfix-82f5c41a-20261028`:
`resume-ready-fenced.passed.json` and `unfence.passed.json`.
The initial staging attempt failed a directory-mode assertion because tar restored
its root directory mode. The service had not been stopped; the reviewed resume
verified staged bytes and corrected only that release directory before proceeding.

Live UI verification: owner name/avatar render, ReviewRouter key storage is first
and selected by default, existing dedicated OpenRouter account is reused. A new
non-default profile with `openai/gpt-4.1` was saved. Its real test request answered
in 2.4 seconds at 23:47 UTC. Only the existing disposable repository
`777genius/rr-selfhost-direct-v2-e2e-20260730t120036z` was assigned this profile;
the workspace default was preserved.

Real review execution is in progress through canonical GitHub rerun
[40092003089, attempt 2](https://github.com/777genius/rr-selfhost-direct-v2-e2e-20260730t120036z/actions/runs/40092003089)
for PR18/head `d24097ed`. The fresh request is bound to execution
`rr:execution:14e2ceb223ae2a34303fcc47985942a0a67ec626`; History projects it as
running. Remaining: successful model execution/publication, another rerun in the
same History row, workspace isolation and outbox checks. Keep `in_progress`.

The new main commit `5551a572` (#736) changes CI runners and a catalog test only;
it requires no production runtime rollout. It has not been claimed as the image
source. Full #739 CI is not green (Quality Checks/Gates failed); the owner-approved
manual targeted-check deployment exception remains the basis for this rollout.

## Ordered rollout

Follow the [release process](../operations/07-environments-and-release-management.md). Record the exact selected commits and installed versions separately for each environment.

1. Reconcile existing services, native configuration, schema history, and active operations. Preserve protected configuration and credentials. Apply any earlier required migration cutovers from the installed-to-target range.
2. Apply native migration `258_gateway_openrouter_dynamic_models.sql` through the existing `repository.ApplyMigrations` operator path, preserving checksum and `schema_migrations` checks. Native startup does not apply migrations. Verify 258 in the target database.
3. Build `sub2api/backend/cmd/account-gateway` with the repository-pinned Go toolchain. Stop the existing Node Gateway and wait for its managed native child to exit. Install the qualified binary at the existing protected `native.executable` path, update protected `native.sha256`, and deploy the compatible Node Gateway. Restart the existing service; Node owns native lifecycle. Do not launch a second native instance.
4. Deploy the ReviewRouter no-flag follow-up to all Web/API/worker roles using the exact approved release. Account discovery is active without an environment switch or internal opt-in. Remove obsolete catalog switches from managed deployment configuration when updating it. Preserve ownership, account authorization, capabilities, and freshness fences.
5. Complete the live verification below and update this task and the index with durable evidence.

There is no separate catalog activation command or ReviewRouter catalog migration. Other included changes can still require migrations or activation, including [Review History](2026-10-28-review-history.md).

## Verification and completion

- Verify native migration 258, Gateway/native versions and binary hash, and matching ReviewRouter fleet commits/images.
- Check public health/status and the provider UI. ReviewRouter is first/default; OpenRouter key entry and continuation work; current user name/avatar render.
- Confirm the account catalog includes authorized models beyond enrollment anchors. Save a model, reload, and verify it reaches execution.
- Reuse an existing disposable repository for a real Gateway review using a dynamically selected model, including a model different from enrollment. Verify successful completion and publication by the configured GitHub App.
- Verify invalid/expired catalogs and revoked/foreign accounts remain denied. The existing account-reference harness supplies local UI/authority checks; local fixtures do not replace the deployed review.

Only mark an environment `deployed` after all applicable checks pass, recording exact native/Gateway/application versions, migration evidence, timestamp/operator, test PR/run, and durable receipt links.

## Retry, partial completion, and rollback

Before resuming, reconcile already applied migration history, installed binary/config hash, service lifecycle, and running fleet. Do not replay inference after an uncertain provider outcome; inspect the original run first. Preserve migration records and credentials.

Record partial failures as `blocked`. A catalog environment toggle is no longer a rollback mechanism. Use a previously qualified compatible deployment under the release guide's rollback preflight, retaining applied schema and migration constraints. Record residual state and recovery steps.

## Related links

- [Catalog behavior](../product/10-provider-connections-ux.md).
- [Gateway SDK and provenance](../../vendor/account-gateway/README.md).
- [Native entrypoint](https://github.com/agent-teams-ai/sub2api/blob/b3f012af5a54f1ffcccc1d34987a48120d1c39aa/backend/cmd/account-gateway/main_linux.go).
- [Native migration](https://github.com/agent-teams-ai/sub2api/blob/b3f012af5a54f1ffcccc1d34987a48120d1c39aa/backend/migrations/258_gateway_openrouter_dynamic_models.sql).
- [Gateway service](https://github.com/agent-teams-ai/account-gateway/blob/e754d67656a2ac7812024d121d1a73ce3e587e6b/services/account-gateway/src/service.ts).
- [Account-reference E2E](../../scripts/accounts-reference-e2e/README.md).

## Execution log

| Time (UTC)       | Environment | Operator           | Actual version / image                             | Step and observed result                                                                                                                                                                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                     | Next action                                                                                                                |
| ---------------- | ----------- | ------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Not executed     | staging     | Unassigned         | Not verified                                       | No rollout verified by this record.                                                                                                                                                                | None                                                                                                                                                                                                                                                                                                                                                                                         | Reconcile and deploy dependencies.                                                                                         |
| 2026-10-28 19:25 | production  | Codex (owner task) | `366fa74c` / `29135fbaa6bb`                        | Read-only fleet/schema reconciliation and candidate preparation; production unchanged. Pre-deploy gate blocked.                                                                                    | Reconciliation above; [candidate PR #739](https://github.com/777genius/review-router-ai/pull/739), [queued CI](https://github.com/777genius/review-router-ai/actions/runs/40753311508); cancelled #737 CI runs [40751898238](https://github.com/777genius/review-router-ai/actions/runs/40751898238), [40744072509](https://github.com/777genius/review-router-ai/actions/runs/40744072509). | Await explicit owner response on manual exception or successful required exact-commit CI; then resume the ordered rollout. |
| 2026-10-28 23:52 | production  | Codex (owner task) | Serving `1e3a5379` / `ffae730f`; target `4dd75ecf` | Explicit manual exception received. Backup and targeted preparation passed; native migration and application image transfer in progress. Final image, fleet rollout, and activation not confirmed. | Production progress above; [selected runtime source](https://github.com/777genius/review-router-ai/commit/4dd75ecfe3d22701ba741f451b046f0b5e440231).                                                                                                                                                                                                                                         | Native READY_FENCED → final image → Prisma151/ACL → fleet → capture/activation → live review/rerun/isolation.              |
