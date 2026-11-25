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

| # | Guarantee and existing owner | Bounded correction | Code LOC | Test LOC | C/R/U |
| --- | --- | --- | ---: | ---: | --- |
| 1 | GitHub authorization cannot be revoked or revived by a stale refresh | Atomically claim a durable refresh attempt per user/app; fence success and failure against captured authority; an ambiguous consumed token requires reauthorization, not automatic reuse | 170-300 | 170-300 | 5/9/10 |
| 2 | Revocation invalidates repository visibility despite late discovery | Bind all permission-cache publication/read and negative entries to active app-scoped authorization generation; share #1's authority | 80-150 | 80-150 | 4/9/10 |
| 3 | A customer's GitLab CI never receives the shared backend token | Wire an explicitly supplied project/group CI review credential through the existing reviewToken capability and setup form; remove shared-token fallback and preserve installation authorization | 80-160 | 80-140 | 3/9/9 |
| 4 | Rejected HTTP bodies do not first consume unbounded memory | Reuse the bounded reader pattern for affected handlers, with route-specific limits and stream cancellation | 80-160 | 60-110 | 2/9/9 |
| 5 | An unresponsive GitHub observation cannot hold subsequent worker phases indefinitely | Reuse existing deadlines, abort and retained in-flight bounds; timeout leaves an uncertain observation, never authorizes duplicate workflow dispatch | 120-220 | 120-200 | 4/9/10 |
| 6 | Quota truncation cannot masquerade as SCM removal or evict a still-admitted repository | Decide stable admission under the installation DB fence; use full inventory identity and reject stale unseen inserts as well as changes/removals | 120-240 | 120-220 | 4/9/10 |
| 7 | Concurrent ruleset work reconciles the latest desired settings and exposes unresolved effects honestly | Serialize by remote organization/ruleset identity, re-read desired revision, fence status writes; retain durable reconciliation after uncertain or superseded effects | 240-400 | 190-300 | 5/9/10 |
| 8 | Every persisted requested ruleset state has its durable outbox event | Use the same transaction client for desired revision and public outbox writer; derive event identity from revision, not a timestamp | 80-120 | 80-120 | 3/10/10 |
| 9 | Rate-limit cleanup cannot delete a concurrently renewed active bucket | Recheck expiry in DELETE; lock/skip selected rows as appropriate; prove the actual race with two PostgreSQL connections before claiming it | 5-15 | 70-120 | 2/9/8 |
| 10 | Pool saturation has finite wait and a defined overload outcome | Set a runtime acquisition timeout, map saturation to retryable unavailable behavior, preserve maintenance/migration budgets | 40-90 | 50-100 | 3/9/9 |
| 11 | Usage cleanup is bounded and cannot starve ingestion/reconciliation | Bounded indexed delete batches with multi-replica coordination/time budget; decouple cleanup failure from reconciliation and report it | 120-220 | 100-180 | 4/9/9 |
| 12 | Usage reads avoid hydrating every grant/family into application memory | SQL family relations and exact coverage aggregates; bounded delivery-loss detail pages; preserve the existing report deadline and exact totals | 220-400 | 160-260 | 6/9/9 |
| 13 | Explicit workspace links never silently select another workspace | Fetch the requested authorized workspace separately from the limited switcher; fail explicitly for an inaccessible ID | 70-130 | 60-100 | 3/10/10 |
| 14 | A disconnected/slow Action client does not leave uncontrolled upstream streaming | Connect downstream close to the current AbortController, cancel the reader and honor backpressure | 50-90 | 80-130 | 3/9/10 |

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

| Boundary | Required evidence |
| --- | --- |
| OAuth/cache | Concurrent refresh, late failure, revoke during refresh, stale cache publication, reauthorization generation, normal authorized access |
| GitLab setup | Existing install flow with a distinct CI credential; shared backend and broad install tokens absent from variables, responses and logs; missing credential is actionable |
| HTTP admission | Chunked oversized body aborted early, valid maximum payload accepted, malformed/auth-denied requests keep stable error behavior |
| Worker recovery | Hanging observation times out; later work proceeds; retained in-flight bound; late result and retry never duplicate workflow effects |
| Repository sync | At/over quota, new alphabetical first item, rename, true removal, concurrent stale generation, stable admitted membership |
| Ruleset/outbox | Competing desired revisions with reversed response order, duplicate event, persistence/enqueue failure atomicity, uncertain effect recovery |
| PostgreSQL | Real two-session rate-limit race, concurrently renewed tombstone, bounded retention backlog and overlapping workers, cutoff/index query behavior, migration rehearsal for added schema |
| Usage reads | Large-period coverage and family fixtures: bounded response/working set, exact totals, stable pagination and cross-workspace denial |
| Workspace | More than ten memberships; explicit old workspace opens correctly; denied ID never opens another workspace; default selection remains valid |
| Action proxy | Real loopback client disconnect/slow consumer/normal stream; upstream signal and reader closed; no protocol corruption |
| Integration | Strict owner TS7 projects, formatting/lint/architecture gates, generated Action parity if affected, existing required CI and relevant browser journey |

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

Pending. Record exact revisions, commands/results, remaining uncertainty and
review resolutions here as work completes. The deployment task tracks the
separate schema/configuration/runtime rollout and rollback requirements.
