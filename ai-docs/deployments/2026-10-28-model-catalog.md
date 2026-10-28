# Account model catalog: coordinated deployment

- Task ID: `2026-10-28-model-catalog`.
- Goal: discover and execute authorized Codex/OpenRouter account models without a feature flag.
- Affected services: sub2api native, Account Gateway, ReviewRouter Web/API/worker.
- Implementation: [ReviewRouter catalog](https://github.com/777genius/review-router-ai/commit/b2f40048559a841f41b6756c8eac2ed90b04c2d4) plus the no-flag follow-up containing this record.
- Dependencies: native [b3f012af5a54f1ffcccc1d34987a48120d1c39aa](https://github.com/agent-teams-ai/sub2api/commit/b3f012af5a54f1ffcccc1d34987a48120d1c39aa), Gateway [e754d67656a2ac7812024d121d1a73ce3e587e6b](https://github.com/agent-teams-ai/account-gateway/commit/e754d67656a2ac7812024d121d1a73ce3e587e6b), and their qualified catalog contract.
- Last updated: 2026-10-28.

## Environment status

| Environment | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step                                                                                 |
| ----------- | --------- | ------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------- |
| staging     | `pending` | Not verified                    | Not verified        | Reconcile native/Gateway and application versions; follow the ordered rollout.                       |
| production  | `blocked` | `366fa74c` / `29135fbaa6bb`     | 2026-10-28 19:25    | Pre-deploy CI gate; explicit manual exception requested, owner response pending. No runtime changes. |

`pending` records missing deployment evidence, not observed absence. Implementation checks do not prove production readiness.

## Production reconciliation: 2026-10-28

The pre-deploy read-only reconciliation observed the serving application at
`366fa74c`, image `29135fbaa6bb`. No production application, database, Gateway,
or native runtime was changed by this attempt.

The application migration ledger contains 158 entries. Compared with the
candidate source, shared migration checksums have no drift. Three retained
historical ledger-only names are `000116_hosted_v4_fenced_dispatch`,
`000117_hosted_v4_one_shot_dispatch`, and
`000118_exclusive_test_publication`; their absence from the current source is
recorded separately from checksum drift. `000151_review_history` is pending.
The native ledger contains 305 entries with checksum parity; nine native
migrations remain pending, including 258.

Prepared application candidate:
[`f5b62bed64be616272d99cb95913b71e4fb9fccc`](https://github.com/777genius/review-router-ai/commit/f5b62bed64be616272d99cb95913b71e4fb9fccc),
[PR #739](https://github.com/777genius/review-router-ai/pull/739). Its local
qualification passed 111 focused tests, API and provider-accounts typechecks,
and targeted lint/format/diff checks. These results establish preparation,
not deployment or Review History activation.

**Pre-deploy gate:** the required full exact-commit CI has not completed:
the #737 runs were cancelled at the owner's request and candidate CI remains
queued. An explicit exception for a manual deployment without full CI was
requested in the current owner chat; the response is pending. Keep production
`blocked` until that decision or the required exact-commit evidence is available.
This is a pre-deploy gate, not an infrastructure outage or a failed release.
No migration, fleet rollout, capture enablement, or activation was attempted.

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

| Time (UTC)       | Environment | Operator           | Actual version / image      | Step and observed result                                                                                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                     | Next action                                                                                                                |
| ---------------- | ----------- | ------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Not executed     | staging     | Unassigned         | Not verified                | No rollout verified by this record.                                                                             | None                                                                                                                                                                                                                                                                                                                                                                                         | Reconcile and deploy dependencies.                                                                                         |
| 2026-10-28 19:25 | production  | Codex (owner task) | `366fa74c` / `29135fbaa6bb` | Read-only fleet/schema reconciliation and candidate preparation; production unchanged. Pre-deploy gate blocked. | Reconciliation above; [candidate PR #739](https://github.com/777genius/review-router-ai/pull/739), [queued CI](https://github.com/777genius/review-router-ai/actions/runs/40753311508); cancelled #737 CI runs [40751898238](https://github.com/777genius/review-router-ai/actions/runs/40751898238), [40744072509](https://github.com/777genius/review-router-ai/actions/runs/40744072509). | Await explicit owner response on manual exception or successful required exact-commit CI; then resume the ordered rollout. |
