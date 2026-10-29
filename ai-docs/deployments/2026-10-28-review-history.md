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

| Environment | Status     | Actual deployed version / image      | Last verified (UTC) | Evidence / remaining action                                                                                                    |
| ----------- | ---------- | ------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| staging     | `pending`  | Not verified                         | Not verified        | Reconcile installed state, then complete the rollout and live verification below.                                              |
| production  | `deployed` | `b8eac8ec` / image prefix `fd52caab` | 2026-10-29 01:27    | Capture/activation, real reviews, repeat runs, UI and two foreign-workspace isolation checks passed; see final evidence below. |

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
does not establish completed deployment. The first selected runtime source was
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

This read-only inspection did not establish a new environment inventory or lift
any release HOLD. Its source and endpoint observations do not supersede the
production receipts below: History was verified on the b8/fd52 fleet at 01:27 UTC.
Staging remains `pending`. Before a further rollout, reconcile the actual fleet,
schema, capture and coverage against those receipts and the release guide; reuse
completed migration and activation steps. The local qualification below adds
implementation evidence without changing the recorded deployment status.

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
records receipts and their limits. This local qualification performed no
staging/production deployment or live external review. It preserves the separate
production verification below and leaves staging `pending`.

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
- Production deployment and live verification: see the execution log and 01:27 UTC completion record below. Staging verification remains pending.

## Execution log

| Time (UTC)       | Environment | Operator           | Actual version / image      | Step and observed result                                                                                                                                                                                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                     | Next action                                                                                                                                                                   |
| ---------------- | ----------- | ------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not executed     | staging     | Unassigned         | Not verified                | No environment work verified by this record.                                                                                                                                                                   | None                                                                                                                                                                                                                                                                                                                                                                                         | Reconcile state and prerequisites; select the approved release.                                                                                                               |
| 2026-10-28 19:25 | production  | Codex (owner task) | `366fa74c` / `29135fbaa6bb` | Read-only fleet/schema reconciliation and candidate preparation; production unchanged. Pre-deploy gate blocked.                                                                                                | Reconciliation above; [candidate PR #739](https://github.com/777genius/review-router-ai/pull/739), [queued CI](https://github.com/777genius/review-router-ai/actions/runs/40753311508); cancelled #737 CI runs [40751898238](https://github.com/777genius/review-router-ai/actions/runs/40751898238), [40744072509](https://github.com/777genius/review-router-ai/actions/runs/40744072509). | Await explicit owner response on manual exception or successful required exact-commit CI; then resume the ordered rollout.                                                    |
| 2026-10-28 23:52 | production  | Codex (owner task) | `4dd75ecf` / `3d2fd2df`     | Recorded four-role fleet adoption, Prisma151/ACL and enabled capture; activation passed at 20:22:19.946Z and a fresh runtime canary passed. This replaces the stale preparation-only note for this checkpoint. | [Recorded 23:52 fleet/activation observation](#production-observation-2026-10-28-2352-utc) below; selected source `4dd75ecfe3d22701ba741f451b046f0b5e440231`.                                                                                                                                                                                                                                | At this checkpoint: finish the in-flight PR18 review, repeat-run, workspace isolation and outbox verification; retain completed migration/activation receipts without replay. |

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

Attempt2 finished as `incomplete`, matching the failed required coverage.
GitHub App publication and the History status transition are confirmed. Six
History-change outbox events are processed without error. The owner can read the
run, while two different real workspaces receive no run for its row ID. Successful
review and the second History run remain unverified; status stays `in_progress`.

### Current fleet and final E2E blocker: 2026-10-29

The four application roles adopted source
`b8eac8ec11ec9fe0db5c3a8da2974a30a269a8cc` at 00:32:50 UTC, image
`sha256:fd52caab0a1a55d92711010e36b98c77f939b60eb1f62d9db7548b532d693cc8`.
Opaque container configuration was preserved and prior containers retained stopped.
Capture remains enabled on all writers; no migrations or History activation were
repeated. Fresh runtime canary returned 200 with all three role proofs and a
successful write/read. Protected receipts are in
`/srv/platform/projects/review-router/releases/model-history-adoption-b8eac8ec-20261029/`.
Signed-in repository readiness now shows 4/4 with `openai/gpt-4.1` read back;
public API/demo/OpenAPI checks passed. Cross-workspace History reads returned no
foreign runs, and the foreign repository setup read returned 404 without leaking
repository data.

Attempt4 was correctly rejected by `skills_engine_unsupported` while a separate
temporary Skills assignment existed; its owner later removed it. Attempt5 then
captured lifecycle capability for the dynamic model, but exposed public Action
`review_action_v2_assignment_missing` before model calls: restored plan slots were
new objects while assignments retained old object references. No Gateway execution
was created for that attempt. Do not fabricate closure or completion records.

The minimal public Action fix is
[PR #352](https://github.com/777genius/review-router/pull/352), reviewed head
`ceda367f79ef24c225a8da45b7a5dcfea562714e`, version 1.0.219. It rebinds assignments
to validated final plan slots, preserving the strict adapter identity guard and
all authorization/protocol contracts. Focused203 tests and release/artifact27
checks passed locally; the required public CI build is still running. Publication,
normal release/registration, a fresh disposable modern review and lifecycle rerun
remain before declaring complete. Old PR18's five legacy manual findings are
preserved; they are ineligible for automatic lifecycle verification.

### Action219 adoption: 2026-10-29 01:15 UTC

Public [PR352](https://github.com/777genius/review-router/pull/352) passed required
CI40796820936 (8m21s), merged normally through the owner identity guard to
`298e7fca999edaee09b59d438a5694ed8961d394`, and the official
[Release40797791976](https://github.com/777genius/review-router/actions/runs/40797791976)
passed (8m46s), publishing `v1.0.219` and stable `v1`. Canonical manifest generation
and checker passed against the installed compatible backend contract.

The compatible Action-only overlay preserved application source/image b8/fd52,
all opaque container configuration, current API implicit Skills preference,
47 prior configured attestations,45 existing producer DB rows, two historically
absent producer IDs, and the exact limits/SLO profiles. All four roles now carry
48 attestations, primary Action219 and its exact installer tuple. Old primary and
overlap order remain available for admitted runs; prior containers remain stopped.
No private version tag, native/Gateway binary or database schema was changed.

Registration first stopped before materialization on two module hash pins:
preparation had resolved TypeScript source exports without production conditions.
Read-only evidence showed source/dist bytes unchanged in both retained and serving
containers. A separately reviewed, once-issued resume corrected only those two
pins to production `dist`; the original failure was preserved. Registration then
succeeded through the normal configured-attestation trusted materializer at
`2026-10-29T01:15:19.945Z` with immutable readback and unchanged previous records.
No direct SQL writes or default profile fabrication were used.

Protected custody:
`/srv/platform/projects/review-router/releases/action219-adoption-298e7fca-20261029/`,
including `apply-receipt.json`, original `registration.result.json`, and
`registration.resume1.accepted.json`. Inputs and proof are retained in sibling
`action219-inputs-298e7fca-20261029/`. Fresh runtime canary passed200/all3proofs,
with receipt in `model-history-adoption-b8eac8ec-20261029/fresh-action219-runtime-canary.passed.json`.
API/demo/OpenAPI/docs checks also passed after the overlay. Official workflow
channel promotion40799311636 is running; final modern review and lifecycle rerun
remain before completion.

### Review History production verification complete: 2026-10-29 01:27 UTC

A fresh disposable [PR20](https://github.com/777genius/rr-selfhost-direct-v2-e2e-20260730t120036z/pull/20)
was created in the existing E2E repository; no new repository was created. Both
actual reviews used approved public Action219 through GitHub App dispatch and
published complete results. First workflow40799468766 correctly failed its merge
gate for one major finding after full2/2-file publication; this was not an
execution/publication failure. Fixed-head workflow40800168729 passed in2m5s,
with publication completed and Gateway close applied. First Gateway execution
also closed, with24 completed requests and zero occupied transports.

Owner authenticated History reads returned exactly one PR row
`d6c2e7c6-b86b-403c-8205-c19349b3966b` with correct title/link and latest status
`completed`; its expanded runs show two `completed` reviews and the initial
superseded draft request as `stopped` (sequence3). The same runs read from each
of the other two real workspaces returned200 with empty items. Actual dashboard
search `reviewSearch=20`, history expansion and Refresh were exercised; the UI
showed Completed. Coverage remains available since20:22:19.946Z, not backdated.
All36 repository History change events since01:16 were processed, with zero
recorded errors. Avatars decoded successfully in the signed-in UI.

A separate public Action timestamp-classification bug leaves the prior finding
unverified despite the second full review succeeding. It does not block History
capture, status projection, repeat-run grouping or isolation. Overall release E2E
continues under the catalog task until that genuine finding lifecycle check passes.
