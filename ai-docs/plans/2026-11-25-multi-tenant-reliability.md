# Multi-tenant reliability: bounded correction plan

Date: 2026-11-25. Baseline: `95201f4e0d63d3ab7c4d585a1e55a6317e84ca6b`.
Owner request: implement all fourteen audited findings in one Draft PR, review
this plan twice before implementation, push each commit promptly, qualify the
changed journeys end to end, resolve critical findings, and merge normally.

## Scope and completion

This batch corrects existing authorization, GitLab setup, HTTP admission,
worker recovery, repository inventory, organization ruleset provisioning,
database maintenance, usage reads, workspace selection and Action streaming.
It does not add a product feature, new service, queue, framework, feature flag,
provider implementation, dependency upgrade or unrelated refactoring.

The existing owners, PostgreSQL/outbox/lease mechanisms, repository quota,
provider contracts, retained retry evidence and TS 7.0.2 toolchain stay in use.
Only migrations and small owner-local helpers required by these guarantees are
in scope. Any changed public input is wired through its current callers and UI.
Production deployment, credential rotation and external repository mutations
are rollout operations; merge alone does not prove their execution.

Completion requires all fourteen items resolved or disproved by actual evidence,
two recorded plan-review rounds, focused failure/concurrency tests, the relevant
real HTTP/PostgreSQL/browser journeys, strict owner typechecks, mandatory CI on
the reviewed source, review without unresolved critical findings, normal merge,
and inspection of merged-main checks. Skipped/queued checks are not passes.

## Findings and smallest intended changes

Scores are engineering estimates, not measured availability. C = complexity
(higher is harder), R = achievable reliability for the stated guarantee,
U = confidence in the diagnosis, each out of ten. LOC is handwritten changed or
new code/SQL; generated files are excluded. Tests are estimated separately.

| #   | Guarantee and existing owner                                                                           | Bounded correction                                                                                                                                                                              | Code LOC | Test LOC | C/R/U   |
| --- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------: | -------: | ------- |
| 1   | GitHub authorization cannot be revoked or revived by a stale refresh                                   | Atomically claim a durable refresh attempt per user/app; fence success and failure against captured authority; an ambiguous consumed token requires reauthorization, not automatic reuse        |  170-300 |  170-300 | 5/9/10  |
| 2   | Revocation invalidates repository visibility despite late discovery                                    | Bind all permission-cache publication/read and negative entries to active app-scoped authorization generation; share #1's authority                                                             |   80-150 |   80-150 | 4/9/10  |
| 3   | A customer's GitLab CI never receives the shared backend token                                         | Wire an explicitly supplied project/group CI review credential through the existing reviewToken capability and setup form; remove shared-token fallback and preserve installation authorization |   80-160 |   80-140 | 3/9/9   |
| 4   | Rejected HTTP bodies do not first consume unbounded memory                                             | Reuse the bounded reader pattern for affected handlers, with route-specific limits and stream cancellation                                                                                      |   80-160 |   60-110 | 2/9/9   |
| 5   | An unresponsive GitHub observation cannot hold subsequent worker phases indefinitely                   | Reuse existing deadlines, abort and retained in-flight bounds; timeout leaves an uncertain observation, never authorizes duplicate workflow dispatch                                            |  120-220 |  120-200 | 4/9/10  |
| 6   | Quota truncation cannot masquerade as SCM removal or evict a still-admitted repository                 | Decide stable admission under the installation DB fence; use full inventory identity and reject stale unseen inserts as well as changes/removals                                                |  120-240 |  120-220 | 4/9/10  |
| 7   | Concurrent ruleset work reconciles the latest desired settings and exposes unresolved effects honestly | Serialize by remote organization/ruleset identity, re-read desired revision, fence status writes; retain durable reconciliation after uncertain or superseded effects                           |  240-400 |  190-300 | 5/9/10  |
| 8   | Every persisted requested ruleset state has its durable outbox event                                   | Use the same transaction client for desired revision and public outbox writer; derive event identity from revision, not a timestamp                                                             |   80-120 |   80-120 | 3/10/10 |
| 9   | Rate-limit cleanup cannot delete a concurrently renewed active bucket                                  | Recheck expiry in DELETE; lock/skip selected rows as appropriate; prove the actual race with two PostgreSQL connections before claiming it                                                      |     5-15 |   70-120 | 2/9/8   |
| 10  | Pool saturation has finite wait and a defined overload outcome                                         | Set a runtime acquisition timeout, map saturation to retryable unavailable behavior, preserve maintenance/migration budgets                                                                     |    40-90 |   50-100 | 3/9/9   |
| 11  | Usage cleanup is bounded and cannot starve ingestion/reconciliation                                    | Bounded indexed delete batches with multi-replica coordination/time budget; decouple cleanup failure from reconciliation and report it                                                          |  120-220 |  100-180 | 4/9/9   |
| 12  | Usage reads avoid hydrating every grant/family into application memory                                 | SQL family relations and exact coverage aggregates; bounded delivery-loss detail pages; preserve the existing report deadline and exact totals                                                  |  220-400 |  160-260 | 6/9/9   |
| 13  | Explicit workspace links never silently select another workspace                                       | Fetch the requested authorized workspace separately from the limited switcher; fail explicitly for an inaccessible ID                                                                           |   70-130 |   60-100 | 3/10/10 |
| 14  | A disconnected/slow Action client does not leave uncontrolled upstream streaming                       | Connect downstream close to the current AbortController, cancel the reader and honor backpressure                                                                                               |    50-90 |   80-130 | 3/9/10  |

Shared implementation reduces #7+#8 to about 300-500 code and 240-380 test lines.
After review 1 the combined estimate is 1,455-2,675 code/SQL and
1,390-2,390 test lines.
An estimate is not a cap that justifies an incomplete guarantee. Record actual
changes and explain material deviations instead of adding speculative layers.

## Failure and compatibility boundaries

- Authorization: durably claim before sending the one-use refresh request; a
  crash/response loss cannot permit reuse. Fence refresh outcomes, expiry and
  decryption failures, discovery's late 401, callback save and webhook revocation.
  Cache writers include bulk discovery and mutation live checks; capture their
  authority before HTTP, never stamp stale evidence with a newly read generation.
  Read authority and cache consistently, scope negative entries by app/generation,
  and invalidate existing unversioned cache rows during additive migration.
  Use one revision plus a persisted refresh-attempt ID; advance authority when
  claiming so old-token 401s cannot revoke an in-flight newer attempt. Distinguish
  a concurrent attempt from a durable unknown outcome; only explicit successful
  refresh or reauthorization clears the attempt.
- GitLab: masking or protecting a shared CI variable is insufficient. Never
  substitute the user's broad installation token as the review credential.
  Existing exposed tokens, if any, require separately recorded operator rotation.
- HTTP: enforce actual streamed bytes, not only Content-Length. Preserve valid
  encrypted setup payload sizes; return stable sanitized errors.
- Recovery: timeout means unknown remote state. Preserve persisted evidence and
  existing no-duplicate admission. Bound installation-client acquisition, search,
  run inspection, runner-wait inspection and cancellation; retain in-flight slots
  until the underlying IO settles, even if abort is ignored. Add a maintenance-pass
  budget so a page of stalled calls cannot multiply the delay of other phases.
  Late IO results cannot execute unchecked state-changing continuation code.
- Inventory: the 250 repository quota is deliberate and stays unchanged. Actual
  missing repositories still revoke selection and rotate identity correctly;
  inventory generation must reject stale synchronization including previously
  unseen inserts. Choose admission using durable selected IDs under installation
  serialization, outside GitHub IO; preserve reconnect/transfer fencing and update
  the quota runbook to retain admitted repositories then deterministically fill slots.
  Use one bounded inventory transaction and an installation generation watermark,
  retaining existing global repository-scope guard ordering.
- Rulesets: an after-the-fact database CAS alone cannot fence a GitHub mutation.
  The existing PostgresAdvisoryLock name aliases a finite lease; do not mistake it
  for a session lock. Bound HTTP and check ownership/revision before each subsequent
  effect. On a superseded or unknown effect, retain/requeue durable reconciliation
  for the latest desired revision, including restart; never settle unknown as
  configured. Use a bounded owner-specific unresolved-operation scan only if the
  existing outbox cannot retain this work. Finite retry exhaustion stays visible.
  This promises honest unresolved state and convergence after observable effects,
  not impossible fencing of arbitrarily delayed writes inside GitHub.
  Selected recovery owner: existing outbox stale-claim retry. Read back before
  configured; a late superseded completion atomically queues current-revision
  repair. No new generic reconciler or always-on GitHub polling is introduced.
- Database: cleanup batches release locks promptly, are safe across replicas,
  and cannot erase a new rate-limit window. Keep all owned maintenance work awaited
  through allSettled, inspect failures, and release the per-process pending guard
  only after settlement. Classify actual Prisma/pg acquisition errors narrowly;
  avoid blanket statement timeouts or matching every timeout as overload.
- Usage: no silent truncation of totals, no split-family double counting, bounded
  detail payloads, stable pagination and unchanged tenant/period filtering. Exact
  totals still scan period rows and facets scale with distinct dimensions within
  the current 15-second budget; this batch adds no preaggregation/cache/OLAP.
  Detect overlapping child manifests across all scoped summaries before dimension
  filtering; match null parentScope with IS NOT DISTINCT FROM and keep invocation
  identity. Preserve summary/complete-children preference, partial/unbounded counts
  and missing-child conflicts using the existing in-memory implementation as oracle.
  Coverage details have their own cursor, query-key participation and filter/scope
  reset; whole-period counts remain independent of that details page.
- Workspace selection: explicit missing/unauthorized identifiers must not fall
  back to another workspace. Preserve supported ID/slug/account URL keys and
  installation links; default selection without an explicit key stays unchanged.
- Streaming: client cancellation, upstream failure, normal completion and whole
  proxy shutdown release owned resources once; preserve existing protocol bytes.

## Sequence and review checkpoints

1. Publish this plan and open one Draft PR. Inspect live main/open PRs first;
   #1003 owns observation retry/deadline work, #998 dashboard/worker extraction,
   #959 native providers. Do not copy their unrelated changes or merge their PRs.
2. Round 1: independently challenge guarantees, scope, counterevidence and
   resource ownership; revise this document with findings and decisions.
3. Round 2: challenge the revised plan, especially refresh/cache races, remote
   effects, quota behavior, SQL concurrency and bounded query correctness.
   Begin implementation only after these reviews are recorded.
4. Implement by existing owner, in parallel only for disjoint files. Root owns
   shared schema integration, composition, docs, publication and final evidence.
   Publish each coherent commit immediately to this same branch.
5. Run targeted tests after each owner slice. Integrate actual PostgreSQL and
   HTTP/stream tests; use the existing dashboard/browser fixture for changed UI.
6. Independent implementation review plus adversarial root review. Fix critical
   findings and rerun the affected checks; avoid repeating unrelated passing runs.
7. Run full required gates on the final source, reconcile main and open-PR overlap,
   mark Ready, wait for actual results, inspect comments and resolve findings.
8. Merge through the ordinary owner/plugin path with expected head; verify merge
   commit attribution, changed tree and post-merge required checks. Leave rollout
   records accurate; this task does not assert production installation.

## Validation matrix

| Boundary        | Required evidence                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OAuth/cache     | Concurrent refresh, late failure, revoke during refresh, stale cache publication, reauthorization generation, normal authorized access                                                 |
| GitLab setup    | Existing install flow with a distinct CI credential; shared backend and broad install tokens absent from variables, responses and logs; missing credential is actionable               |
| HTTP admission  | Chunked oversized body aborted early, valid maximum payload accepted, malformed/auth-denied requests keep stable error behavior                                                        |
| Worker recovery | Hanging observation times out; later work proceeds; retained in-flight bound; late result and retry never duplicate workflow effects                                                   |
| Repository sync | At/over quota, new alphabetical first item, rename, true removal, concurrent stale generation, stable admitted membership                                                              |
| Ruleset/outbox  | Competing desired revisions with reversed response order, duplicate event, persistence/enqueue failure atomicity, uncertain effect recovery                                            |
| PostgreSQL      | Real two-session rate-limit race, concurrently renewed tombstone, bounded retention backlog and overlapping workers, cutoff/index query behavior, migration rehearsal for added schema |
| Usage reads     | Large-period coverage and family fixtures: bounded response/working set, exact totals, stable pagination and cross-workspace denial                                                    |
| Workspace       | More than ten memberships; explicit old workspace opens correctly; denied ID never opens another workspace; default selection remains valid                                            |
| Action proxy    | Real loopback client disconnect/slow consumer/normal stream; upstream signal and reader closed; no protocol corruption                                                                 |
| Integration     | Strict owner TS7 projects, formatting/lint/architecture gates, generated Action parity if affected, existing required CI and relevant browser journey                                  |

Real HTTP against local fixture providers and real disposable PostgreSQL proves
these component boundaries; it does not claim paid provider or production E2E.
Reuse existing harnesses and test repositories. Do not call real paid providers,
modify customer repositories or weaken required checks to make tests pass.

## Plan review record

- Round 1: three independent source reviews (auth_plan_review,
  worker_plan_review, db_plan_review) plus root integration review completed.
  Accepted corrections: durable one-use refresh claim, all late-401/cache writers,
  app/generation-aware cache migration, explicit GitLab credential contract, whole
  recovery-pass bound, DB-fenced stable quota admission, remote-effect uncertainty
  and revision-based transactional events, settled maintenance ownership, actual
  pool-error qualification, SQL family parity and a narrower truthful memory bound.
  Estimates increased only for the identified concurrency/migration work. Root
  added existing workspace URL-key compatibility and pre-response disconnect cases.
- Round 2: all three independent reviewers approved the revised plan. Final
  acceptance details added: advance auth revision at durable refresh claim,
  distinguish concurrent/unknown refresh state, one transactional inventory
  admission fence, existing outbox recovery plus readback/current-revision repair
  for rulesets, an independent coverage cursor, and renewed-tombstone concurrency.
  No unresolved critical design finding remains. The unknown external-effect
  limitation stays explicit; implementation review must verify these guarantees.

## Implementation and verification record

### Implemented scope

All fourteen corrections are integrated in this PR. Core source checkpoint:
`43204bd6b6934ba1181bf22e37aa519b89757f18`. The SCRAM/body follow-up is
`74a8d9d5fa2baf79e054a797d41d2f468d8e1fad`; the generated streaming Action is
`784d6f30c41ce06a05390c3960a0310f249cb5fe`. Browser/CI evidence wiring and the
source-graph-dependent conflict bundle are included with this record. Each commit
was immediately published to the same Draft PR.

The material estimate increase is in #7/#8 and failure qualification. A lease and
a final revision comparison could not preserve uncertainty when a late HTTP
response coincided with database failure or another workspace addressed the same
organization. Two nullable markers on the existing provisioning row, one
normalized-organization index, and atomic settlement/repair through the existing
outbox close those cases. There is no new table, service, queue or polling loop.
The only package additions are two existing workspace packages as test dev
dependencies; external dependency versions are unchanged.

Four additive migrations (`000161`–`000164`) carry authority/cache versions,
inventory/ruleset revision, a concurrent retention-cutoff index and unresolved
ruleset identity. Oversized Web owners were reduced/extracted and their ceilings
lowered. The conflict runtime has no semantic change: changed auth/database
inputs affect minified symbol names; the ordinary builder regenerated it and its
source parity and standalone CLI test passed.

### Observed local verification

These are observed executions, not counts inferred from source. Real PostgreSQL
means a disposable local PostgreSQL 17.10 server; HTTP means actual loopback HTTP
with controlled responses. Counts from overlapping suites must not be summed as
unique cases. Final CI uses the repository's pinned PostgreSQL images.

| Boundary                    | Observed result and evidence                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization/cache         | 38 initial focused tests, 63 follow-up auth/cache/mutation/recovery/API tests and 46 dashboard-loading tests passed. Eight real PG/HTTP tests passed again in a fresh SCRAM-authenticated cluster, including SELECT-only read-only cache access, concurrent claims, revocation, late 401, reauthorization and lost refresh response.                                                    |
| GitLab/setup/body           | 70 affected route/setup tests passed; final route validation 9/9 and three body-boundary files 6/6 passed. The actual GitLab install use case, gateway and database passed 1/1 PG/HTTP flow: separate review credential in CI variables, installation credential only in request authorization, rejected shared/installer credentials before HTTP, and no secret persisted or returned. |
| Recovery                    | 96 focused cases passed, with deadline/cancellation and retained in-flight ownership. Strict owner TS7 passed.                                                                                                                                                                                                                                                                          |
| Inventory/quota             | 40 unit cases and 3 real PG cases passed, including stable admitted membership and stale-generation rejection. Quota remains 250; small deterministic race fixtures use a smaller configured test cap.                                                                                                                                                                                  |
| Ruleset/outbox              | 28 unit/HTTP cases and 12 real PG/HTTP cases passed. A second reviewer independently initialized a fresh PG17.10 cluster, applied all 169 maintained migrations including the final organization index, and repeated all 12 tests successfully. Actual outbox claims and processing are exercised.                                                                                      |
| Rate limits/pool            | Real two-session renewal/cleanup race passed without deleting the active bucket. Query acquisition and transaction-start saturation returned their actual bounded pg/Prisma errors; an already-owned transaction remained usable. Narrow 503 mapping preserves unrelated/custom errors.                                                                                                 |
| Usage retention/report      | 19 real PG cases, 6 real GET/PGlite cases and 44 final UI/model/GET cases passed. Retention backlog and concurrent workers, null parent scopes, family precedence, exact totals, tenant filters and independent detail pagination are covered.                                                                                                                                          |
| Large usage qualification   | Six scenarios passed with 200,000 records, 1,100 families and 10,000 grants. Full report: 25 projections, 542 aggregate/detail records, 337,763 JSON bytes, about 3.87 s on this fixture. Families: 10,500 stored rows to 25 projections; coverage details at most limit+1. The existing 15 s report budget is unchanged.                                                               |
| Workspace                   | 11 loader tests, including two real PG cases, passed with more than ten memberships and a forbidden workspace. Related dashboard/shell checks passed. Explicit ID, slug and supported installation/account keys retain their authorization behavior.                                                                                                                                    |
| Streaming Action            | Five real HTTP cases passed for disconnect, slow consumers/backpressure, shutdown and normal bytes. Generated artifact verification with required binaries and source parity passed.                                                                                                                                                                                                    |
| Typechecking and formatting | Strict native TS7.0.2 owner projects passed for the changed owners, including ruleset/locks with Go memory limits and the browser tooling project. Full Web compilation is separately required in CI; a killed local compiler is not recorded as a pass. Changed-file formatting and whitespace checks passed.                                                                          |

The large-query old-payload comparison reads the same former hydration rows in
bounded fixture pages to count exact rows/JSON bytes without crashing the test
process. It is not a measured old one-shot query latency or a production capacity
benchmark. Some earlier disposable raw logs were lost during checkout
materialization; results above were observed in tool responses, and those logs
were not recreated. The SCRAM and independent final PG runs have fresh actual
receipts. CI regenerates and uploads qualification evidence from its own run.

### Implementation review and resolved findings

Independent auth/root-boundary and database/worker reviewers approved their final
source with zero unresolved P0/P1. The auth reviewer covered GitLab, body limits,
workspace authorization, streaming and final CI/browser wiring. The database
reviewer also repeated the complete fresh migration/ruleset run. Root reviewed
integration, schema, publication, generated artifacts and acceptance boundaries.

Resolved review findings include:

- Final mutation admission now rejects revoked authority even when stale cache
  publication is correctly fenced; read-only cache transactions remain read-only.
- Missing GitLab review credentials produce a specific actionable error; the
  readonly PG test role authenticates under SCRAM as well as local trust.
- A definitive superseded create rejection clears only its own create marker.
  Late HTTP settlement and repair enqueue are atomic. Another workspace's unknown
  operation blocks mutation/configured settlement for the normalized organization.
- Browser denial assertions inspect the visible Next not-found UI, and page two
  checks the exact cursor, invocation and actor/workspace scope, not just row count.
- Usage qualification gets its own transient PostgreSQL cluster so fixture role
  cleanup cannot affect concurrently running application/authorization suites.

### Final integration evidence and acceptance

[PR #1007 checks](https://github.com/777genius/review-router-ai/pull/1007/checks)
are the authoritative current-head integration record. The final acceptance
record in that PR identifies completed workflow runs and the merge result. This
source record does not pre-claim a queued, skipped or unexecuted check.

The existing **Statistics Usage Reviews browser** journey now also opens the
old authorized workspace, paginates 101 loss details through real GETs, denies a
foreign workspace visibly, and exercises the GitLab credential UI with keyboard
and six viewport/theme combinations. GitLab UI network responses are fixture
responses; the backend boundary is separately exercised by the actual PG/HTTP
install test. Browser screenshots must be inspected before acceptance.

The existing **Quality Gates** and **Dedicated Release Authority PG17 contract**,
full host typecheck/build/lint/architecture/tests, generated artifact parity and
relevant browser run must complete successfully before normal merge. Merge uses
the expected reviewed head and preserves owner attribution; merged-main checks
are inspected afterward. A fresh result is required after any relevant fix.

### Operational limits

The [deployment task](../deployments/2026-11-25-multi-tenant-reliability.md)
records separately authorized rollout, writer draining, migrations, configuration
and rollback. An uncertain refresh requires reconnect; an uncertain ruleset write
requires confirmed recovery using the
[operator runbook](../operations/org-ruleset-recovery.md). Neither is erased merely
to retry. Exact usage totals still scan the selected period. Local fixtures and
CI do not assert production installation, a real paid-provider review, credential
rotation or a customer-repository mutation.
