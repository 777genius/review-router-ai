# Review History: deployment and activation

- Task ID: `2026-10-28-review-history`.
- Goal: record new GitHub v2 reviews and show their lifecycle and repeat runs in
  the workspace Reviews section.
- Affected services: application PostgreSQL, Web, all API/worker review writers,
  and the existing outbox worker.
- Implementation: [PR #730](https://github.com/777genius/review-router-ai/pull/730).
- Reviewed source reference: `7de48814092dff0f49bf5978459d278b23c7d35b`.
  Select and verify the actual merged release separately; this SHA is provenance.
- Last updated: 2026-10-29.

## Environment status

| Environment | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / remaining action                                                              |
| ----------- | --------- | ------------------------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| staging     | `pending` | Not verified                    | Not verified        | Reconcile installed state, then complete the rollout and live verification below.        |
| production  | `pending` | Not verified                    | Not verified        | Verify release prerequisites and staging evidence, then complete the production rollout. |

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

## Read-only readiness reconciliation: 2026-10-29

Protected main `89ce21cccbd5e979baf46450ecb8bb5b1b599e90` passed trusted push
[CI 40800988408](https://github.com/777genius/review-router-ai/actions/runs/40800988408),
attempt 1, including successful `Dedicated Release Authority PG17 contract` and
`Full private PG16 to PG17 rehearsal` jobs. Their unexpired artifacts
`12866922946` and `12866966379` were downloaded read-only: ZIP SHA-256 values
matched GitHub's digests, and both manifests bound this exact repository, commit,
run, attempt, job name and SHA-derived artifact name. The checked paired artifact
`12867515185` bound the same source to Action
`056952b5a3d625fd1d19384942d452114804380f` (`v1.0.218`). This establishes source
readiness for that tuple; it does not select or publish a release.

Existing [native TEST 40758960764](https://github.com/777genius/TEST-ci-cancellation-20261026/actions/runs/40758960764)
qualified source `2b54edf2bfabac25f5343d65bd66e100e57d88b7` with active History:
one dispatch/discovery/cancellation, four projected History facts and one cleanup
ACK, with no remaining owned obligations or replay. The job was cancelled before
runner allocation. Its [durable evidence](evidence/2026-10-28-dispatch-cleanup-history-native.md)
does not claim App/OIDC authentication, provider execution, admission, publication,
the joined dashboard path, or staging/production deployment.

Public API health/readiness and Web returned HTTP 200 on 2026-10-29 around
09:05 UTC; readiness reported the database healthy. These endpoints do not prove
installed source, migration 151, capture flags or coverage. An already-existing
[review run 40845515696](https://github.com/777genius/review-router-ai/actions/runs/40845515696)
failed during `review_run_authorize` with HTTP 500 / `ambiguous_outcome`; this is
an unresolved live authorization observation, not evidence of a History defect.
No review, workflow, deployment or activation was initiated by this inspection.

Both environment statuses remain `pending`. Before live verification, obtain the
approved target and existing operator/provider access; reconcile its actual
schema, fleet versions, capture flags and coverage marker, exact release/image
evidence, and the release guide's existing catalog HOLD against current evidence.
Complete the ordered rollout above, including all-writer convergence and explicit
activation, then retain live review/rerun, isolation and outbox results. No current
environment inventory or evidence lifting that HOLD was established here. The
local qualification below establishes implementation continuity, separately from
the live environment checks still required above.

## Joined local qualification: 2026-10-29

The follow-up on base `89ce21cccbd5e979baf46450ecb8bb5b1b599e90` passed 16 backend
tests in two files, with no failures or skips, and the real `history-source`
SSR/API/Chromium scenario. Per-file hashes bind the local test changes; the base
commit alone does not identify them. Two manual requests on the same PR/SHA
traversed production ingress, dispatch, authorization/execution, publication and
completion owners, then the registered History outbox handler and actual readers.
Queued, running, publishing and receipt-backed completed states agreed with the
refreshed UI; rerun retained one PR row and two ordered runs. The three foreign
workspace GETs returned 403/private-no-store; authorized other-workspace reads
remained empty. External GitHub/OIDC/provider adapters and login were synthetic.

Independent review closed the factory-failure cleanup P2: a real post-seed
configuration rejection now removes only owned rows, preserves borrowed workspace,
membership, coverage and emergency control, restores fetch and disconnects.
Final backend/tooling gates passed on unchanged sources. Browser cleanup and its
independent SQL/role readback passed; browser/runtime errors and external requests
were empty. Three desktop captures were reviewed. The
[review record](../plans/2026-10-28-review-history-reviews.md#joined-source-to-browser-qualification-2026-10-29)
records receipts and their limits. No staging/production deployment or live
external review was performed; both environment statuses remain `pending`.

## Related links

Implementation sources below retain the reviewed PR #730 provenance. The exact
main evidence above and these source links are not deployment evidence.

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

| Time (UTC)   | Environment | Operator   | Actual version / image | Step and observed result                     | Evidence | Next action                                                         |
| ------------ | ----------- | ---------- | ---------------------- | -------------------------------------------- | -------- | ------------------------------------------------------------------- |
| Not executed | staging     | Unassigned | Not verified           | No environment work verified by this record. | None     | Reconcile state and prerequisites; select the approved release.     |
| Not executed | production  | Unassigned | Not verified           | No environment work verified by this record. | None     | Reconcile state and prerequisites; verify staging/release evidence. |
