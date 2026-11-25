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
| 1 | GitHub authorization cannot be revoked or revived by a stale refresh | Serialize refresh per user/app; re-read; fence success and failure against the captured authorization generation; bound HTTP time without holding a transaction across the network | 130-230 | 130-220 | 4/9/10 |
| 2 | Revocation invalidates repository visibility despite late discovery | Bind permission-cache publication/read to active authorization generation; share #1's generation, with no duplicate authority | 60-110 | 80-140 | 3/9/10 |
| 3 | A customer's GitLab CI never receives the shared backend token | Remove shared-token export; wire an explicit project/group-scoped CI credential or the existing manual-secret setup path; preserve GitLab installation authorization | 80-160 | 80-140 | 3/9/9 |
| 4 | Rejected HTTP bodies do not first consume unbounded memory | Reuse the bounded reader pattern for affected handlers, with route-specific limits and stream cancellation | 80-160 | 60-110 | 2/9/9 |
| 5 | An unresponsive GitHub observation cannot hold subsequent worker phases indefinitely | Reuse existing deadlines, abort and retained in-flight bounds; timeout leaves an uncertain observation, never authorizes duplicate workflow dispatch | 120-220 | 120-200 | 4/9/10 |
| 6 | Quota truncation cannot masquerade as SCM removal or evict a still-admitted repository | Separate full inventory identity from quota admission; retain existing admitted repositories within the unchanged quota; preserve real-removal identity fencing | 60-120 | 100-180 | 3/9/10 |
| 7 | Concurrent ruleset work converges to the latest desired settings | Serialize the external effect per ruleset, re-read version, fence status writes; reconcile an uncertain external result before treating it as configured | 180-320 | 150-240 | 5/9/10 |
| 8 | Every persisted requested ruleset state has its durable outbox event | Commit desired revision and existing outbox event in one short transaction, external permission checks outside it | 60-120 | 80-140 | 3/10/10 |
| 9 | Rate-limit cleanup cannot delete a concurrently renewed active bucket | Recheck expiry in DELETE; lock/skip selected rows as appropriate; prove the actual race with two PostgreSQL connections before claiming it | 5-15 | 70-120 | 2/9/8 |
| 10 | Pool saturation has finite wait and a defined overload outcome | Set a runtime acquisition timeout, map saturation to retryable unavailable behavior, preserve maintenance/migration budgets | 40-90 | 50-100 | 3/9/9 |
| 11 | Usage cleanup is bounded and cannot starve ingestion/reconciliation | Bounded indexed delete batches with multi-replica coordination/time budget; decouple cleanup failure from reconciliation and report it | 120-220 | 100-180 | 4/9/9 |
| 12 | Usage page work and response size are bounded without losing aggregate correctness | SQL coverage aggregation and bounded details; bound family metadata while preserving complete-family deduplication/totals | 220-400 | 160-260 | 5/9/9 |
| 13 | Explicit workspace links never silently select another workspace | Fetch the requested authorized workspace separately from the limited switcher; fail explicitly for an inaccessible ID | 70-130 | 60-100 | 3/10/10 |
| 14 | A disconnected/slow Action client does not leave uncontrolled upstream streaming | Connect downstream close to the current AbortController, cancel the reader and honor backpressure | 50-90 | 80-130 | 3/9/10 |

Shared implementation reduces #7+#8 to about 220-380 code and 200-320 test lines.
The combined initial estimate is 1,255-2,325 code/SQL and 1,290-2,200 test lines.
An estimate is not a cap that justifies an incomplete guarantee. Record actual
changes and explain material deviations instead of adding speculative layers.

## Failure and compatibility boundaries

- Authorization: fence both refresh outcomes and every revocation/reauthorization
  writer. An old cache must remain unusable even if its write arrives late.
  Lease loss and an ambiguous one-use refresh response must not cause blind retry.
- GitLab: masking or protecting a shared CI variable is insufficient. Never
  substitute the user's broad installation token as the review credential.
  Existing exposed tokens, if any, require separately recorded operator rotation.
- HTTP: enforce actual streamed bytes, not only Content-Length. Preserve valid
  encrypted setup payload sizes; return stable sanitized errors.
- Recovery: timeout means unknown remote state. Preserve persisted evidence and
  existing no-duplicate admission. In-flight work remains bounded after timeout.
- Inventory: the 250 repository quota is deliberate and stays unchanged. Actual
  missing repositories still revoke selection and rotate identity correctly;
  inventory generation must reject stale synchronization.
- Rulesets: an after-the-fact database CAS alone cannot fence a GitHub mutation.
  Handle duplicate events, changed desired state, lease loss, response loss and
  restart using the existing owner and durable desired state.
- Database: cleanup batches release locks promptly, are safe across replicas,
  and cannot erase a new rate-limit window. Avoid blanket statement timeouts.
- Usage: no silent truncation of totals, no split-family double counting, bounded
  detail payloads, stable pagination and unchanged tenant/period filtering.
- Workspace selection: explicit missing/unauthorized IDs must not fall back to
  another workspace. Default selection without an explicit ID stays unchanged.
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
| PostgreSQL | Real two-session rate-limit race, bounded retention backlog and overlapping workers, cutoff/index query behavior, migration rehearsal for added schema |
| Usage reads | Large-period coverage and family fixtures: bounded response/working set, exact totals, stable pagination and cross-workspace denial |
| Workspace | More than ten memberships; explicit old workspace opens correctly; denied ID never opens another workspace; default selection remains valid |
| Action proxy | Real loopback client disconnect/slow consumer/normal stream; upstream signal and reader closed; no protocol corruption |
| Integration | Strict owner TS7 projects, formatting/lint/architecture gates, generated Action parity if affected, existing required CI and relevant browser journey |

Real HTTP against local fixture providers and real disposable PostgreSQL proves
these component boundaries; it does not claim paid provider or production E2E.
Reuse existing harnesses and test repositories. Do not call real paid providers,
modify customer repositories or weaken required checks to make tests pass.

## Plan review record

- Round 1: pending.
- Round 2: pending.

## Implementation and verification record

Pending. Record exact revisions, commands/results, remaining uncertainty and
review resolutions here as work completes. The deployment task tracks the
separate schema/configuration/runtime rollout and rollback requirements.
