# Review History: deployment and activation

- Task ID: `2026-10-28-review-history`.
- Goal: record new GitHub v2 reviews and show their lifecycle and repeat runs in
  the workspace Reviews section.
- Affected services: application PostgreSQL, Web, all API/worker review writers,
  and the existing outbox worker.
- Implementation: [PR #730](https://github.com/777genius/review-router-ai/pull/730).
- Reviewed source reference: `7de48814092dff0f49bf5978459d278b23c7d35b`.
  Select and verify the actual merged release separately; this SHA is provenance.
- Last updated: 2026-10-28.

## Environment status

| Environment | Status        | Actual deployed version / image      | Last verified (UTC) | Evidence / remaining action                                                                               |
| ----------- | ------------- | ------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------- |
| staging     | `pending`     | Not verified                         | Not verified        | Reconcile installed state, then complete the rollout and live verification below.                         |
| production  | `in_progress` | `4dd75ecf` / image prefix `3d2fd2df` | 2026-10-28 23:52    | Prisma151/ACL, fleet/capture and explicit activation passed. Live review running; rerun/isolation remain. |

No environment rollout was performed or verified when this record was created.
`pending` means completion has no recorded evidence; do not infer existing live
flags, schema, or coverage from the PR state. Keep completion evidence separate
for each environment. Local test activation does not satisfy this task.

## Applicability and prerequisites

Use this task when the exact authorized release includes Review History from
PR #730. Confirm its merge, release inclusion, relevant checks, and the required
release evidence under the [release process](../operations/07-environments-and-release-management.md).
PR checks alone are not the production release evidence required by that guide.
Until the feature is included, leave this task pending.

Inventory the actual database migration state, running Web/API/worker versions,
writer replicas, capture configuration, and any existing coverage marker before
executing steps. Resolve existing release/catalog holds using their current
evidence; this record does not declare those holds lifted.

Apply all earlier prerequisites in the pending migration range. In particular:

- If crossing `000089` through `000091`, follow the existing runtime ACL fence,
  stop/drain, and release-authority reopening procedure.
- If crossing `000145` through `000146`, follow the stopped-fleet backup,
  migration, and provider-profile conversion procedure before starting new code.

See the [database release and cutover rules](../operations/07-environments-and-release-management.md#database-release-rule).
Migration 151 is additive; that does not make the entire pending migration chain
safe for a rolling upgrade. No separate prerequisite task records have yet been
inventoried here; create/link them if the selected rollout needs them.

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

Execute the applicable steps separately for staging and production using the
existing release path. Record each completed step and evidence in the execution
log; reconcile already completed steps before resuming a partial rollout.

1. **Prepare the exact release.** Record target environment, approved commit/image,
   release evidence, current fleet/schema, prerequisites, and rollback constraints.
   Use the existing environment credentials without copying them into this file.
2. **Migrate before starting the new binaries.** Apply the normal application
   migration chain through `000151_review_history` under the preceding cutover
   rules. Verify migration success in the target database. Capture flag `0` does
   not make the new Prisma client compatible with an old schema. Managed PG17
   checkout admission is not evidence that the application database was migrated.
3. **Roll out compatible code with capture disabled.** Deploy the new Web/API/
   worker code, including the history outbox handler and every source capture
   hook, with `REVIEW_ROUTER_REVIEW_HISTORY_CAPTURE=0`. Verify exact fleet versions.
   Keep the handler available independently of capture and publication credentials
   so previously accepted history events can drain.
4. **Enable every writer.** Set `REVIEW_ROUTER_REVIEW_HISTORY_CAPTURE=1` on every
   API and worker that can create or change v2 reviews. Finish the rollout and
   verify version/flag convergence before activation. On first activation, hooks
   remain dormant until the coverage marker exists. If a marker already exists,
   enabling writers resumes capture immediately; account for the prior gap and
   follow the recovery guidance below.
5. **Activate explicitly after all writers are ready.** With the approved
   database connection for this environment, run:

   ```bash
   pnpm history:activate --confirm-writers-ready
   ```

   The command uses `DATABASE_URL` or `REVIEW_ROUTER_DATABASE_URL_FILE`. Record the
   returned coverage timestamp, never the credential. Activation is idempotent:
   repeating it preserves the original timestamp. Startup alone is not activation.

6. **Verify the live feature.** In the existing disposable test repository, start
   a new supported review after activation. Confirm a PR row appears in Reviews,
   its status updates after refresh, and an explicit rerun appears in that same
   PR's history. Confirm another workspace cannot read the PR row or runs.
   Check service health and history outbox processing/failures/dead letters.
7. **Record completion before widening rollout.** Record actual version/image,
   migration and fleet evidence, coverage timestamp, test PR/run links, isolation
   result, operator, and verification time. Mark only this environment `deployed`
   after every applicable step succeeds; update the index in the same commit.

The [feature runbook](https://github.com/777genius/review-router-ai/blob/7de48814092dff0f49bf5978459d278b23c7d35b/ai-docs/operations/review-history.md)
owns the capture/activation details. Recheck it at the actual shipping version
for changes before executing this reference procedure.

## Scope and verification meaning

History begins at the coverage boundary for new supported GitHub v2 reviews.
Existing history and unsupported legacy/GitLab paths are not backfilled.
`Completed` means confirmed publication, not code approval or absence of findings.
A browser fixture or disposable database test is implementation evidence; the live
deployment check above is still required. Repository enumeration and some search
queries have documented costs proportional to tenant history; no latency SLA is
established by this task.

## Partial completion, failure, and rollback

Capture failures roll back the source transaction; use existing source/outbox
diagnostics rather than bypassing capture or fabricating history facts. Investigate
`review.history.changed` failures through the existing redrive procedure.

To stop new capture, disable `REVIEW_ROUTER_REVIEW_HISTORY_CAPTURE` on all source
writers and retain a compatible history worker to drain accepted events. Record
the gap, including possible missing final states for already active reviews.
Preserve the coverage marker and additive History tables/columns. Reconcile fleet
versions and configuration before restoring capture; the original timestamp does
not prove gap-free history after an operator disablement.

Any binary rollback must also pass the release guide's
[API rollback preflight](../operations/07-environments-and-release-management.md#api-rollback-protocol-preflight)
and all earlier migration-cutover constraints. A version that can ignore History's
additive columns may still be incompatible with other applied migrations. Record
partial failure as `blocked`, or an intentional reversal/disablement as
`rolled_back`, with actual remaining code/schema/flags and the next safe step.

## Related links

Implementation sources below are pinned because PR #730 may not yet be merged
when this registry is read. They are not links to deployment evidence.

- [PR #730](https://github.com/777genius/review-router-ai/pull/730),
  [commits](https://github.com/777genius/review-router-ai/pull/730/commits), and
  [changed files](https://github.com/777genius/review-router-ai/pull/730/files).
- [Implementation plan](https://github.com/777genius/review-router-ai/blob/7de48814092dff0f49bf5978459d278b23c7d35b/ai-docs/plans/2026-10-28-review-history-implementation.md),
  [review and qualification record](https://github.com/777genius/review-router-ai/blob/7de48814092dff0f49bf5978459d278b23c7d35b/ai-docs/plans/2026-10-28-review-history-reviews.md), and
  [composition decision](https://github.com/777genius/review-router-ai/blob/7de48814092dff0f49bf5978459d278b23c7d35b/ai-docs/decisions/032-review-history-scoped-composition.md).
- [Feature operations runbook](https://github.com/777genius/review-router-ai/blob/7de48814092dff0f49bf5978459d278b23c7d35b/ai-docs/operations/review-history.md),
  [migration 000151](https://github.com/777genius/review-router-ai/blob/7de48814092dff0f49bf5978459d278b23c7d35b/packages/platform/db/prisma/migrations/000151_review_history/migration.sql),
  [activation command](https://github.com/777genius/review-router-ai/blob/7de48814092dff0f49bf5978459d278b23c7d35b/scripts/activate-review-history.ts), and
  [configuration example](https://github.com/777genius/review-router-ai/blob/7de48814092dff0f49bf5978459d278b23c7d35b/.env.example).
- [Backend feature and PostgreSQL tests](https://github.com/777genius/review-router-ai/tree/7de48814092dff0f49bf5978459d278b23c7d35b/packages/features/review-history),
  [browser qualification instructions](https://github.com/777genius/review-router-ai/blob/7de48814092dff0f49bf5978459d278b23c7d35b/scripts/statistics-e2e/README.md), and
  [History browser scenario](https://github.com/777genius/review-router-ai/blob/7de48814092dff0f49bf5978459d278b23c7d35b/scripts/statistics-e2e/history-scenario.ts).
- [Implementation CI at the reference head](https://github.com/777genius/review-router-ai/actions/runs/40715436756),
  [release process](../operations/07-environments-and-release-management.md),
  [quality gates](../operations/03-quality-gates.md), and
  [migration/backup/recovery guidance](../operations/04-migrations-backups-recovery.md).
- Actual staging/production deployment and verification evidence: not recorded yet.

## Execution log

| Time (UTC)       | Environment | Operator           | Actual version / image                             | Step and observed result                                                                                                                                                                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                     | Next action                                                                                                                |
| ---------------- | ----------- | ------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Not executed     | staging     | Unassigned         | Not verified                                       | No environment work verified by this record.                                                                                                                                                       | None                                                                                                                                                                                                                                                                                                                                                                                         | Reconcile state and prerequisites; select the approved release.                                                            |
| 2026-10-28 19:25 | production  | Codex (owner task) | `366fa74c` / `29135fbaa6bb`                        | Read-only fleet/schema reconciliation and candidate preparation; production unchanged. Pre-deploy gate blocked.                                                                                    | Reconciliation above; [candidate PR #739](https://github.com/777genius/review-router-ai/pull/739), [queued CI](https://github.com/777genius/review-router-ai/actions/runs/40753311508); cancelled #737 CI runs [40751898238](https://github.com/777genius/review-router-ai/actions/runs/40751898238), [40744072509](https://github.com/777genius/review-router-ai/actions/runs/40744072509). | Await explicit owner response on manual exception or successful required exact-commit CI; then resume the ordered rollout. |
| 2026-10-28 23:52 | production  | Codex (owner task) | Serving `1e3a5379` / `ffae730f`; target `4dd75ecf` | Explicit manual exception received. Backup and targeted preparation passed; native migration and application image transfer in progress. Final image, fleet rollout, and activation not confirmed. | Production progress above; [selected runtime source](https://github.com/777genius/review-router-ai/commit/4dd75ecfe3d22701ba741f451b046f0b5e440231).                                                                                                                                                                                                                                         | Native READY_FENCED → final image → Prisma151/ACL → fleet → capture/activation → live review/rerun/isolation.              |

## Production observation: 2026-10-28 23:52 UTC

Prisma151 and canonical runtime ACL grants passed, preserving all prior ledger
rows. Web/API/worker/scan run source `4dd75ecf`, image
`sha256:3d2fd2dfd5ff4c4b4c02cd513aeaecd450d6508b0fd1d04c01b7c80516891939`.
Capture is enabled on all writers and `history:activate --confirm-writers-ready`
passed at `2026-10-28T20:22:19.946Z`. Fresh API/web/worker canary passed.

A genuine PR18 review is running in workflow40092003089 attempt2. The History
row `2877eeb7-f6ca-4d14-ac29-76af0c481f0e` has one fresh run and status `running`;
the authenticated runs endpoint returns that same run. Two History outbox events
are processed without errors. Completion, second rerun, workspace isolation and
final outbox checks are still required. See the coordinated catalog task for
native update evidence and the selected test model.
