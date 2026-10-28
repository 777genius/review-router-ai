# Account model catalog: coordinated deployment

- Task ID: `2026-10-28-model-catalog`.
- Goal: discover and execute authorized Codex/OpenRouter account models without a feature flag.
- Affected services: sub2api native, Account Gateway, ReviewRouter Web/API/worker.
- Implementation: [ReviewRouter catalog](https://github.com/777genius/review-router-ai/commit/b2f40048559a841f41b6756c8eac2ed90b04c2d4) plus the no-flag follow-up containing this record.
- Dependencies: native [b3f012af5a54f1ffcccc1d34987a48120d1c39aa](https://github.com/agent-teams-ai/sub2api/commit/b3f012af5a54f1ffcccc1d34987a48120d1c39aa), Gateway [e754d67656a2ac7812024d121d1a73ce3e587e6b](https://github.com/agent-teams-ai/account-gateway/commit/e754d67656a2ac7812024d121d1a73ce3e587e6b), and their qualified catalog contract.
- Last updated: 2026-10-28.

## Environment status

| Environment | Status        | Actual deployed version / image                                 | Last verified (UTC) | Evidence / next step                                                                                                             |
| ----------- | ------------- | --------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| staging     | `pending`     | Not verified                                                    | Not verified        | Reconcile native/Gateway and application versions; follow the ordered rollout.                                                   |
| production  | `in_progress` | Serving `1e3a5379` / image prefix `ffae730f`; target `4dd75ecf` | 2026-10-28 20:06    | Manual exception approved; native migrations and image transfer in progress. Await readiness/build/fleet/activation/live checks. |

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

The application fleet is still healthy on the earlier serving source
`1e3a5379ea6268692ed7f0545c9ebd0c9049c5b9`, image prefix `ffae730f`.
Application schema reconciliation found 158 ledger entries with no checksum
drift among shared source migrations; `000151_review_history` remains pending.
Retained historical ledger-only names are `000116_hosted_v4_fenced_dispatch`,
`000117_hosted_v4_one_shot_dispatch`, and `000118_exclusive_test_publication`.
The encrypted application backup completed successfully: label
`20261028-203841F`, start `1793216321`, stop `1793216365`.

Completed targeted preparation:

- 111 catalog/no-flag tests, API and provider-accounts typechecks.
- 24 UI canary tests and three authorized-workspace redirect cases.
- Full application base build at `75cd9d59` and Web/API overlay build at `066220eb`.
- One isolated real-PostgreSQL void-canary test (1/1).
- Native tagged suite: 131 passed; Node 24 Gateway suite: 57 passed.

The exported `066220eb` image archive is 788645900 bytes, SHA-256
`80def3c0bff2ec87e30e063bb233d1f35d181214bd846c0993d273234e743c41`,
with archive config ID
`7bed7bc01114bb38ec909de03de04f7bc8c89221813cb636f2ce9f79a548b053`.
Transfer is in progress; import/load has not been confirmed. After import, the
operator will apply the two-file Web-only redirect overlay and build the final
selected `4dd75ecf` image on production. That final image is not yet built or
verified by this record.

Native preparation includes a private backup and verified 503 admission fence.
Normal Gateway stop and native retirement completed. `ApplyMigrations` is
processing the nine pending native migrations, including 258; the last received
status is in progress. The prior 305-row native ledger had checksum parity.
Do not infer updated native runtime readiness or deployment from these steps.
Admission remains fenced while the application fleet continues on its earlier
healthy version.

Remaining sequence: native `READY_FENCED` receipt → final application image
build → normal Prisma migration through 151 plus canonical ACL handling → fleet
rollout → capture `1` on all writers and explicit History activation → canary,
live UI, real review, rerun, and workspace isolation checks. Record each result
before advancing either task to `deployed`.

Working operator receipts are retained under local
`tmp/production-release-20261028` and `tmp/app-image-export-066220eb`.
These ignored scratch paths alone are not durable completion evidence. No final
runtime/image, live review, or History activation success is claimed here.

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
| 2026-10-28 20:06 | production  | Codex (owner task) | Serving `1e3a5379` / `ffae730f`; target `4dd75ecf` | Explicit manual exception received. Backup and targeted preparation passed; native migration and application image transfer in progress. Final image, fleet rollout, and activation not confirmed. | Production progress above; [selected runtime source](https://github.com/777genius/review-router-ai/commit/4dd75ecfe3d22701ba741f451b046f0b5e440231).                                                                                                                                                                                                                                         | Native READY_FENCED → final image → Prisma151/ACL → fleet → capture/activation → live review/rerun/isolation.              |
