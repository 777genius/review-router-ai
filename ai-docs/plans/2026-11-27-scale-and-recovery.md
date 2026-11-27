# Multi-user scale and recovery without process restarts

Date: 2026-11-27. Audited baseline: `5ab12e2d79a2d60351fd17cca871b32f3d039f13`.
Delivery: one Draft PR, reviewed plan, parallel implementation by existing owner,
real failure/recovery qualification, and repeated independent review until no
confirmed critical finding remains. This is implementation authorization, not a
production deployment or permission to change another PR's scope.

## 1. Outcome and boundaries

ReviewRouter must keep making useful progress when one dependency is slow or
unavailable, recover when that dependency returns, and keep resource use bounded
as users, installations, review history and simultaneous work grow. A healthy
response must describe an actual result. A timeout is uncertainty, not proof that
a remote mutation did not happen.

The owner requested approximately 10,000–20,000 changed lines. The working
envelope below includes meaningful production integration/refactoring, deletion
of replaced paths, failure/concurrency tests and documentation. It is an estimate,
not a reason to pad code, introduce a framework or preserve unnecessary checks.
An experiment that disproves a suspected defect removes that item and its LOC.

### In scope

- Existing worker/outbox/completion owners: independent progress, retained work
  ownership, bounded external observation, orderly stop, accurate partial errors.
- Existing database adapter and selected dashboard readers: server-enforced
  execution budgets, recovery, bounded query count and latest-row retrieval.
- Existing native Gateway consumer policy: recovery from an unavailable catalog
  without restarting API; coherent admission/relay/model policy snapshots.
- Existing GitHub receipt/effect path: atomic local database effects and durable
  completion, without losing a webhook after an interrupted process.
- Accounts inventory and public catalog/request boundaries: bounded optional
  enrichment, final authorization after all remote reads, and body cleanup.
- Focused failure tests through actual HTTP, actual PostgreSQL, worker entrypoints
  and public application seams; operational instructions for the changed paths.
- Removal of superseded duplicate local logic only within those owners.

### Explicitly outside this batch

New services/queues, Redis, distributed caches, generic circuit-breaker frameworks,
new feature flags, provider protocol implementation, authentication/Identity
migration, billing, visual redesign, CI governance changes, production deployment,
credential rotation, customer repository mutation, unrelated dependency upgrades,
outbox deletion that would destroy durable idempotency, and speculative indexes.
Do not rewrite accepted architecture or immutable evidence to pass checks.

The existing PostgreSQL leases, outbox fencing, no-duplicate dispatch admission,
tenant authorization, native/Gateway ownership and strict TypeScript 7.0.2 remain
authoritative. New helpers stay in the existing semantic owner; a new package is
not needed. No in-memory mutex becomes distributed correctness authority.

## 2. Existing work and overlap inventory

Observed from live GitHub on 2026-11-27, not inferred from old conversation state.

| Existing PR | Observed status | Boundary retained in this work |
| --- | --- | --- |
| #1007, `7f038195` | Merged | OAuth/cache fencing, GitLab credential separation, bounded HTTP bodies, observation recovery, stable inventory quota, ruleset/outbox atomicity, pool acquisition deadline, Usage SQL/retention, workspace selection and Action streaming already exist. |
| #1003, #960, #920 | Merged | Preserve exact observation retries/deadlines, uncertain dispatch handling and progress pagination. |
| #998, #977 | Merged | Preserve owner extraction, current Foundation/Get Modular adoption and source boundaries. |
| #959 | Merged | Preserve native provider contracts; ReviewRouter does not copy native provider logic. |
| #1008, `7681003e` | Draft | Do not edit worker `review-v2-projection-envelope.ts` or `review-v2-publication-payloads.ts` and its test. |
| #1020, `46e20e3d` | Open | Do not duplicate `apps/web/src/features/provider-setup/setup-provider.ts` selector fix or its test. |
| #1017, `5183c9f5` | Draft | Gateway management ingress in `deploy/hetzner/apply-domain.sh` belongs to that PR. |
| #1010, `c31ab0b8` | Draft | Shared Identity/SCM plans own future identity/session/account migration. |
| #474, `f4523cae` | Draft | Offline custody envelope rebind and PG17 cutover remain separately owned. |
| #1002, `021c7828` | Draft | Full-root Markdown-reference adoption is not part of this PR. |
| #1015 | Open | Format-only review-history tooling correction may arrive through main. |
| #1013, #1014, #1019 | Open/Draft | Deployment records retain their own observed facts; merge index additions additively. |
| #869, #870, #864, #872 | Draft | Homepage and video work excluded. |

Recheck open PRs and main before final integration. Normal additive index conflicts
do not justify absorbing other PRs. A later merge is not permission to overwrite
its semantics with the audited baseline.

## 3. Source findings and acceptance contracts

Scores are engineering judgments: complexity C (higher costs more), expected
reliability R within the stated scope, and diagnosis confidence U, all /10.
Handwritten production/integration LOC P and tests/fixtures LOC T exclude vendor,
generated bundles, lockfiles and documentation. Changed/deleted surrounding code
is reported separately in the final diff to avoid double-counting estimates.

| Workstream | Observed failure and intended correction | P LOC | T LOC | C/R/U |
| --- | --- | ---: | ---: | --- |
| A. Worker owner isolation | `runWorkerBatch` is sequential: catching rejection does not release a permanently pending phase. Give known owners finite observation windows while retaining at most one real invocation per owner until settlement; healthy owners can run again. | 500–900 | 800–1,300 | 6/9/10 |
| B. Stop and claim lifetime | The shutdown signal only gates the next outer batch; outbox continues claiming, and worker signal handlers use `once`. Stop new claims/phases on shutdown, drain already owned effects and keep repeated signals from restoring immediate termination. | 250–500 | 450–750 | 4/9/10 |
| C. GitHub progress/inventory | A never-settling cached `GET /app` promise and unbounded installation/client/request pagination can hold the serial worker. Bound the real transport and whole pass; preserve incomplete inventory and uncertain mutation semantics. | 500–950 | 950–1,500 | 5/9/10 |
| D. Completion batch ownership | `ScanDueReviewCompletionProcesses` uses fail-fast `Promise.all`; one rejection releases the caller while claimed siblings still execute. Await all owned settlements and report failures honestly, preserving exact claims and admission bounds. | 120–300 | 300–550 | 4/9/10 |
| E. Runtime database execution | Pool acquisition is bounded, but acquired SQL has no server execution/lock budget. A locked query can occupy every connection indefinitely. Apply runtime-specific PostgreSQL budgets and narrow unavailable classification; prove recovery after timeout/disconnect. | 250–500 | 600–1,000 | 5/9/9 |
| F. Dashboard query scaling | Installation sync status issues one query per installation. Replace it with a bounded latest-per-installation SQL read. Measure multi-parent nested latest-row reads and change only paths whose SQL actually hydrates unbounded history. | 380–810 | 700–1,350 | 5/9/8 |
| G. Native catalog recovery | Startup discovery failure is caught, but three consumers freeze the empty catalog forever: relay, runtime snapshot and model-settings reader. Share a bounded refresh source for new admission, preserve pinned in-flight facts and local allowances. | 650–1,200 | 1,000–1,700 | 6/9/10 |
| H. Integrated failure qualification | Exercise concurrent tenants, dependency loss/restore, delayed completion, stop and process recovery through the actual changed composition, reusing existing harnesses. Wire relevant strict/CI coverage and operational evidence. | 150–350 | 650–1,200 | 5/9/8 |
| I. Atomic webhook receipts | Delivery is committed as `processing` before separate effects; interruption leaves an unretryable receipt forever. Commit claim, local effects/outbox and processed receipt in one transaction, keeping external preadmission outside it. | 800–1,400 | 1,200–2,000 | 6/9/10 |
| J. Accounts/HTTP resource boundaries | Optional metadata awaits after the final inventory authorization fence; account enrichment can start 100 remote reads; one key route still reads unbounded JSON; non-2xx public-catalog bodies are left open. Fix these existing seams without extra auth layers. | 250–500 | 650–1,100 | 5/9/10 |

Envelope: roughly 3,850–7,400 handwritten production/integration lines and
7,300–12,450 test/fixture lines before rejecting disproved conditional changes or
sharing existing fixtures, plus replaced code and about 400–700 documentation
lines. The target remains a reviewable 10k–20k diff, not the sum of every upper
bound. Confidence in this estimate is 6/10. One experienced engineer would ordinarily
need roughly 12–24 focused engineer-days including integration/review, with
parallel owners reducing elapsed implementation time, not the verification work.

### A. Independent worker progress with retained ownership

1. Keep the known outer-owner phase list explicit in worker composition. Retain
   V2 publication -> terminal promotion -> progress ordering inside that owner,
   plus existing SDK/outbox durable enqueue-before-claim ordering: hung SDK
   recovery does not block unrelated already-durable outbox work. Do not schedule every helper.
   No plugin registry,
   global service locator, persistent scheduling layer or second queue.
2. A phase is idle, running, or settled. A deadline may stop waiting for it but
   cannot release its running slot, pretend it failed safely, or invoke it again.
3. Retain the actual promise until settlement, observe all rejections, and consume
   each result once. A late success must not be logged repeatedly or counted twice.
4. Subsequent passes skip an occupied phase and continue healthy owners. Keep
   bounded phase concurrency and the existing owner-local locks/transactions.
   One overall pass observation budget bounds waiting across all owners; do not
   multiply a full per-phase timeout by the number of owners.
5. Preserve dependencies within one owner; do not parallelize dependent state
   transitions or claim more work than can receive a live lease heartbeat.
6. Propagate a cooperative signal only where the existing boundary can use it.
   Never assert cancellation of an uncooperative promise. Drain retained work
   before disconnecting the database; unresolved native custody stays explicit.
   Before a late read continues into a subsequent effect, check its operation
   signal/deadline or retain the owner's existing durable reconciliation rule.
   An arbitrary effectful promise race alone is not safe continuation fencing.
7. Report completed, failed and still-running work separately. A timeout must not
   become an empty successful result. Logs contain only bounded safe metadata.

Acceptance: hold one phase across multiple passes; a healthy phase completes
twice, the held phase starts once, late rejection is observed, then a fresh pass
recovers it. Repeat with normal HTTP abort and database timeout to demonstrate
real recovery without restarting worker.
One-shot execution awaits actual retained settlements and preserves failure exit
status; only the continuous host uses bounded pass observation.

### B. Graceful shutdown and claim boundaries

Create and own the shutdown controller before starting work. Repeated SIGINT or
SIGTERM requests the same drain. Stop admission before acquiring another claim
and before starting another maintenance owner. If shutdown races with an already
issued claim, settle that acquired claim under its real lease rather than dropping
it or marking a remote effect absent. Do not add a process-exit timer that destroys
unresolved work. Remove only owned listeners on completed drain.

Apply the same contract to the ordinary worker and the existing skill-scan worker
where both consume the same outbox function. Preserve one-shot behavior and error
exit status. Already claimed publication is allowed to settle; shutdown does not
authorize replay, fabricated acknowledgement, or release of foreign claims.

Acceptance: abort between events leaves later events claimable by another worker;
abort during a claim drains that claim; repeated process signals do not interrupt
a retained effect; connection disconnect happens after true drain.

### C. Bounded GitHub operations without mutation retry

- Bound App identity lookup and each actual HTTP
  request. Ensure timeout reaches the underlying fetch, including body reads.
- Pinned Octokit inspection: request 10.0.9 uses `request.signal`, ignores a
  `request.timeout` option and awaits body consumption. App 16.1.2/core 7.0.6 add
  no default deadline. Installation-client construction is local; the actual
  installation-token POST happens in auth-app 8.2.0's request hook and does not
  inherit a visible route's signal. Configure the supported common transport so
  authentication and route/body IO both receive the real bound. Qualify existing
  fresh-token 401 retry behavior before claiming one wire attempt for writes.
- Single-flight App identity discovery has a finite caller wait and retains
  ownership of the real operation. Reset after genuine rejection/settlement;
  late completion may not poison a newer attempt or bypass current authority.
- Bound complete progress/inventory passes, not only each page. Pagination
  cannot multiply a per-request timeout into unbounded worker occupancy.
- Inventory commits only a complete authoritative snapshot. Timeout/abort on
  page two cannot remove unseen repositories or change stable quota admission.
- Progress writes preserve bot authorship, idempotency and existing uncertain
  effect reconciliation. No automatic repeat of an ambiguous POST/PATCH.
- Bound any retained ignored-abort operation count. A caller timeout is not
  permission to create an unlimited stream of abandoned requests.

Acceptance: hanging App discovery, hanging installation token request, endless/slow
pagination, body stall, abort-ignored late result, second-page failure, restored
GitHub and repeated delivery. Verify no partial removal or duplicate publication.

### D. Completion scans and partial failure

After claiming a bounded set, keep ownership until every started execution
settles. Preserve actual successful results and surface failures; do not return
zero advanced work after a partial failure. Return successful values plus bounded
safe per-item failure summaries, never raw AggregateError causes. If adjusting concurrency, claim only
capacity immediately serviced, retaining durable fencing and existing lease
durations. Do not add retry around the whole batch or advance a durable recovery
cursor past unrecorded failed candidates. First correct the proven early-return
bug; broader cursor/fairness changes require their own failing experiment.

Acceptance: one immediate failure plus a held sibling cannot make the next scan
overlap that sibling; multiple failures are observed; healthy claimed work is
accounted for; competing PostgreSQL claimers never own the same live claim.

### E. Database budgets and recovery

Use PostgreSQL statement/lock timeouts at the runtime adapter boundary so the
server cancels the actual statement and releases its connection. A JavaScript
race alone is insufficient. Choose defaults against current endpoint/report
budgets and identify every caller before changing factory defaults.

Chosen integration: optional programmatic execution budget on createPrismaClient,
with one exported runtime budget (initially 30s statement / 5s lock, qualified by
PG tests). Explicitly apply it to API main/effect-authority/comment-custody
clients, Web main/effect-authority clients, ordinary worker and skill worker.
The generic factory's administrative default and injected caller-owned clients
retain their semantics. Release-control's four clients, release-witness's three
clients and operator/restore/migration/rehearsal clients are unchanged. No new
environment knobs. Preserve owner-local SET LOCAL budgets and the 15s Usage
report transaction; acquisition, statement, transaction and endpoint budgets
are distinct guarantees.

Separate ordinary runtime clients from migration, restore, release authority,
operator and explicitly long-running rehearsal clients. Preserve their reviewed
budgets. URL startup options cannot silently disable an enforced runtime budget.
Do not add blanket retries, classify every database error as transient, or map an
execution timeout to the existing acquisition-timeout predicate.

Qualify actual Prisma/adapter-pg error shapes for both model and raw queries;
map only recognized temporary availability failures to stable safe responses.
Do not classify blanket P2028/P2010/all SQLSTATE failures as temporary. Record
the allowed actual error shapes from qualification. Connection loss around
commit is unknown, not proof of rollback; receipt readback determines replay.
Database cancellation inside a transaction rolls back that transaction; no
application code can report a commit that did not occur. Preserve SQL injection
protection and current transaction authority.

Acceptance: one-connection pool, lock held by another connection, slow statement,
blocked write rollback, healthy request after cancellation, backend connection
termination and recovery. Execute with the production-supported PostgreSQL
version; report any additional major-version run separately.

### F. Bounded dashboard reads

Replace installation sync N+1 reads with one parameterized query using an
authorized installation ID set and deterministic latest-row ordering. Return
exactly the existing public statuses, including absent, pending, failed and
equal-timestamp ties. No query-wide row limit may omit some requested parents.

Capture generated SQL for the suspected repository-health, support diagnostics
and policy-head nested `take: 1` reads. If the database returns all historical
children, replace only those owner-local adapters with indexed lateral/latest
queries. Keep workspace/repository/installation predicates inside SQL, preserve
JSON/domain mapping and null behavior, and compare with an independent fixture
oracle. If current SQL is already bounded, retain it and record the result.

Add an index only after an EXPLAIN experiment with representative history shows
the missing access path; use an additive migration with deployment implications.
No deep OFFSET scan, new cache, materialized view or analytics engine.

Acceptance: many installations/parents and much more history than response size;
constant query count for the chosen read, no cross-tenant rows, deterministic
latest row and no change in public DTOs. Record query/row evidence, not a guessed
users-per-second promise.
Empty input performs no broad query, duplicate IDs do not duplicate rows and
returned rows cannot exceed unique requested parents. EXPLAIN must use the actual
production SQL. Add any migration through current strict history/admission gates;
never rewrite old checksums or frozen evidence to admit a new migration.

### G. Native catalog recovery and policy snapshots

One existing-owner source resolves native capabilities for all three consumers;
local configuration still owns configured profiles, token/resource limits and
allowed origins. Discovery cannot add local permission or silently fall back to
legacy protocol semantics. No native provider logic is copied into ReviewRouter.

Use on-demand bounded refresh with coalesced callers and a short retry/cache
policy: positive TTL 30s, failed-attempt cooldown 1s, existing 10s SDK transport
deadline/response-byte cap. No stale admission after expiry and no periodic daemon.
An initial failure denies only new
affected model admission, then a later successful read makes those models usable
in the same API process. Resolve external capabilities before entering a DB
transaction. All decisions within one admission use one immutable snapshot.
Initial capture and transactional matchesAdmission reuse that observation or
reject generation change; matchesAdmission never performs Gateway HTTP. A new
durable admission rejects an observation whose TTL expires before transactional
revalidation; exact persisted replay is exempt from current discovery.

Explicitly decide and test expiry/revocation behavior: never use a known disabled
profile to admit new work, never expand local permissions from stale data, and
do not mutate the captured provider identity of an in-flight durable run. Close,
recovery and cleanup endpoints remain usable during catalog outage. Transport
timeouts keep bounded retained ownership, and late results cannot overwrite a
newer successful snapshot. Existing static/legacy policy still behaves as before.
The durable snapshot stores selected native identity/route/limits, not the entire
catalog. A newly observed disabled profile denies new inference, including in an
existing run, while exact persisted replay, close/readback/cleanup stay available.
Identity drift for a captured profile denies fresh inference; it never substitutes
another provider/product/protocol into the durable authorization.

Acceptance: unavailable at boot -> temporary admission denial -> dependency
restored -> new review admission, runtime snapshot and relay agree without API
restart; concurrent callers make bounded discovery calls; disabled/removed
profile is denied; malformed/oversized catalog is rejected; existing admitted
work retains its captured identity, route and local limits and recovery remains available.

### I. Atomic webhook processing without abandoned receipts

The current `processing` receipt is durable before installation/repository/auth
effects, and only `failed` receipts may retry. A process crash or a failed
`markFailed` write therefore loses the event. Prefer one existing PostgreSQL
transaction for the delivery claim, all local effects, outbox inserts and final
processed receipt. This avoids a new lease/recovery subsystem for an operation
whose effects are already local and short.

Keep signature verification and any remote PR preadmission outside the database
transaction. Instantiate transaction-bound adapters at outer composition; domain
and application code must not import Prisma. Preserve exact delivery identity,
payload hash and duplicate behavior. Use conflict-safe SQL acquisition inside a
transaction: catching PostgreSQL unique violation and continuing would leave the
transaction aborted. Roll back incomplete local effects on every failure.
All bound adapters use that same transaction client, never a nested independent
transaction. A failure receipt may roll back with the failed effects; safe logging
records the local error and redelivery may then acquire a fresh receipt. If commit
succeeded but the HTTP response was lost, the existing receipt prevents replay.
When a concurrent winner aborts, the waiting duplicate must be able to finish.

Trace every receipt-based handler before wiring the unit of work: installation,
repository, authorization revocation, push and PR/setup handling. Preserve the
documented special preadmission ordering. Do not reset historical `processing`
rows automatically: they predate atomicity and may have partial effects. Record
their operator recovery separately instead of turning uncertainty into replay.

Acceptance: injected interruption after each local effect leaves no half-applied
state; redelivery then completes exactly once; concurrent duplicates produce one
effect/outbox; mismatched identities never acquire the existing receipt; auth
revocation remains effective; actual Fastify HTTP -> Prisma -> PostgreSQL path
recovers without a process restart or an event-discard shortcut.

### J. Accounts and request-resource corrections

Move optional metadata enrichment before the existing final session/source/
binding fence. Do not add repeated authorization queries: the final existing
fence must run after all remote reads. Revoked bindings cannot expose old account
labels, usage or actions through a successful metadata fallback.

Give one accounts page a small bounded remote worker count and one total optional
enrichment budget, reusing existing metadata/limits conventions and transport
signals. Preserve authorized local inventory with honest unknown/unavailable live
state after optional enrichment times out. Keep page order/cursor and mandatory
authorization intact. Capacity is retained until actual underlying IO settles;
deadline expiry stops starting additional remote reads.
Start the budget before remote catalog/capability discovery in personal-account
composition, not only before per-row reads. Mandatory local authorization queries
are outside this optional-remote deadline. The initial concurrency guarantee is
per page; do not claim a process-wide cap or add a queued global semaphore without
an experiment showing the need. Every started promise is observed and late results
cannot mutate a returned response. Read cancellation does not apply to enrollment,
explicit quota refresh or lifecycle mutations.

Use the existing bounded JSON reader for provider-key apply. Size the ceiling
against a full 16 KiB key with worst-case JSON escaping plus 100 supported real
repository IDs (the old schema has no finite maximum ID length); document a
256 KiB envelope ceiling and enforce streamed bytes,
not only Content-Length. Cancel/abort rejected and oversized public-catalog
response bodies before clearing their request timeout. Preserve public error
codes and cache fallback behavior; do not invent another reader or fetch layer.
Do not await an uncooperative body cancel forever. Abort owned transport, observe
cancellation rejection and preserve the original source error.

Acceptance: revocation during held metadata removes the row; a 100-row page
against a stalled/recovering Gateway stays within the measured in-flight cap and
budget; non-2xx streaming response closes its socket; chunked oversized ingress
stops early while the documented realistic maximum envelope remains accepted.

Cross-owner fault case: worker observation expires while a real SQL lock still
holds its phase; no second invocation starts, healthy owners continue, then actual
server cancellation/rollback releases the phase. For an atomic webhook canceled
on that lock, redelivery commits one effect/outbox. Connection loss at commit is
unknown until receipt readback. Catalog discovery stays outside all those SQL
transactions and is not repeated with a different policy inside one admission.

## 4. Implementation order and file ownership

| Stage | Owner | Deliverable / dependency |
| --- | --- | --- |
| 0. Audit | Root + three read-only auditors | Current source, open-PR matrix, concrete failures and test seams. Complete before plan review. |
| 1. Plan rounds | All reviewers | Challenge scope, uncertainty, resource/claim custody, security and integration. Root revises after each actual round. |
| 2A. Worker isolation/adapters/drain | Runtime owner | A/B/C/D in existing worker/outbox/repositories/review-progress/review-processes owners, including worker root wiring. |
| 2B. Database and reads | Data owner | E/F in platform-db and selected existing read adapters; propose schema/index changes to root before mutation. |
| 2C. Catalog and HTTP consumers | Gateway consumer owner | G/J in API native catalog/relay/composition/model-settings and Accounts/HTTP seams; coordinate app.ts wiring with root, no open-PR-owned selector edits. |
| 2D. Webhook atomicity/integration | Root | I, shared composition integration, plan/deployment records and publication. |
| 3. Fault integration | Root + each owner | H using real loopback dependencies and a fresh isolated PostgreSQL cluster; strict source projects and focused checks. |
| 4. Cross review | Different owner than implementer | Review implementation/evidence, fix critical findings, repeat affected tests. |
| 5. Final qualification | Root | Main reconciliation, relevant complete CI/E2E, accurate Draft PR evidence and unresolved limitations. |

Agents work in the same checkout only on explicitly disjoint files. Root owns
root package/config changes, shared schema/migration numbering, deployment index,
shared API root integration, CI changes, commits and pushes. Each completed coherent
commit is published immediately to the same PR. No force-push or rewrite of
another contributor's changes. Small revisions may share one commit when they
form one correctness guarantee.

## 5. Review and test strategy

Plan round 1: independent criticism of guarantees and alternatives. Plan round 2:
review revised failure/compatibility contracts. Plan round 3: cross-owner review
of integration seams, exclusions and acceptance criteria. Implementation starts
only after those concrete reviews are recorded. Review is evidence, not GitHub
approval by an independent human.

Implementation review repeats for actual remaining defects, not an arbitrary
number of clean passes. Prioritize critical correctness, cross-tenant access,
unbounded work, duplicate effects, stalled recovery and false success. Reject
ceremonial wrappers, repeated validation after a trusted boundary, unrelated
format churn, speculative configuration and tests that mirror implementation.

Validation order:

1. Reproduce each accepted fault with a meaningful focused test or SQL experiment.
2. Implement and run affected owner tests, including negative/failure outcomes.
3. Run real HTTP/Prisma/PostgreSQL paths, cancellation, multi-worker claims,
   snapshot recovery and process-signal tests. Any skipped real-boundary test is
   pending, never a pass. Use disposable loopback data only.
4. Run original strict TS7 owner projects and the repository's changed preflight,
   lint/architecture/format checks without weakening coverage.
5. Run required full CI and relevant existing regressions on the reviewed head.
   Queued/running checks require waiting, not repeated reruns or bypasses.
6. Re-read reviews/current main; fix concrete failures and rerun affected checks.
7. Record exact head, executed commands/results, observed bounds and rollout
   prerequisites. A green mock test does not prove live production behavior.

Acceptance is bounded fault recovery and resource ownership, not a claimed SLA
or unsupported throughput number. No paid-model call is necessary to prove these
control-plane boundaries; actual model/provider qualification remains separate.

## 6. Rollout and rollback

Maintain one deployment record for this batch and add it to the existing index.
Ordinary API/Web/worker rollout is pending until a separately authorized release.
If an evidence-backed index migration is necessary, record its lock/build cost,
order and rollback separately from application rollback. Drain old workers before
claiming the new shutdown guarantee. Existing durable fences and uncertain remote
effects survive restart and rollback. Never delete pending work to recover health.

## 7. Actual review / implementation record

- Source audit: root plus runtime, database and open-PR/Gateway auditors completed
  the initial concrete findings above. Conditional SQL findings remain experiments.
- Retention counterevidence: AuditEvent contains durable credential-disable and
  usage-redrive authority; webhook receipts and outbox rows contain replay
  barriers. Blanket age-based deletion is explicitly rejected. Health-report
  retention is not needed for the confirmed correction set and is left separate.
- Plan review round 1: three independent critiques completed. Accepted: explicit
  outer-owner topology and whole-pass budget; late-continuation fencing; pinned
  Octokit auth/body transport behavior; truthful settled partial results; runtime-
  only SQL budgets and client inventory; real production SQL/index evidence;
  same-client atomic webhook/commit uncertainty; immutable catalog observations
  and known-disabled inference policy; optional enrichment budget from the first
  remote read; per-page concurrency claim; realistic request envelope; bounded
  rejected-body cleanup. No new workstream or infrastructure was added.
- Plan review round 2: all three independent reviewers approved the revised
  guarantees. Clarified durable SDK/outbox ordering, actual installation-token
  transport, one-shot settlement, captured identity rather than full catalog,
  and rejection when discovery TTL expires before new transactional admission.
- Plan review round 3: three independent cross-owner reviewers approved. They
  checked webhook atomicity against worker custody, runtime SQL against phase
  retention, and catalog freshness against transactional admission. No blocking
  design finding remained. Implementation authorized by the existing user task
  and assigned to the four disjoint owners above.
- Published implementation checkpoint: `3cb28a1456d110215cf6ae0a35fc58e1881ae98d`
  contains the bounded provider-key request and public-catalog response cleanup,
  with their two focused suites (18 tests passed before the environment outage).
  This evidence covers only those files, not A-I or complete J.
- Independent implementation review of that published checkpoint: ingress has
  no critical source finding; catalog cleanup has no critical production finding.
  Review identified a real test-observation flaw: IncomingMessage close is not
  proof of response teardown. The loopback fixture now observes unfinished
  ServerResponse close. This correction requires a new run; the earlier 18 passes
  do not establish the strengthened assertion.
- Execution interrupted: dependency setup exhausted the execution environment's
  resources, and the environment subsequently became unavailable. The last
  executor response is `No usable execution environment is available`. The
  authoritative CI impact-selection job was queued at the last inspection
  ([run 45928097736](https://github.com/777genius/review-router-ai/actions/runs/45928097736)).
  Skipped auxiliary workflows and queued jobs are not passes.
- A/B/C/D, E/F, G, the accounts final-fence part of J, and the beginning of I
  have uncommitted work in the unavailable checkout. Their contents have not
  been reconciled after interruption and are not part of this PR checkpoint.
  Do not treat them as implemented, typechecked, tested or review-complete.
- Full implementation, PostgreSQL/worker E2E, strict checks, complete
  implementation review, the 10-20k meaningful-change target and final CI remain
  pending. This Draft must not be promoted on the evidence above.

### Resume checkpoints and concrete holds

1. Recover the existing checkout before resetting, reinstalling or replacing it.
   Compare each owner's confirmed files with the published branch. Verify the
   interrupted HTTP/installation-status test writes and the repaired
   runtime-snapshot capture test for truncation. Preserve source before any
   dependency cleanup. The two direct Octokit Core dependencies are approved
   existing-version dependencies; regenerate their lock importers coherently.
2. Worker owner: retained outer phases, signal/drain, completion settlements and
   progress/inventory transport changes are written but untested. Qualify actual
   App/token/body traffic, retained capacity, V2 inner stop boundaries and the
   intentional wait for admitted work. Reconcile all completion-result callers.
3. Data owner: runtime budget, Web wiring, draft availability classification,
   test fixture and installation-status lateral query are written but untested.
   Actual Prisma model/raw timeout wrappers and rollback/release must be measured.
   The lateral query must not ship without a measured supporting access path.
   Conditional health/policy readers and schema migrations are still untouched.
4. Native owner: lazy shared catalog and per-admission observation qualification
   are written but untested. Fix the V3-narrowed final branch in
   `review-run-runtime-snapshot.ts` to test `!original.gateway || nativeIsFresh()`;
   checking snapshotVersion 4 there is redundant after the V4 early return.
   Add and execute relay replay/close, V4 observation and model-settings tests.
   Accounts metadata-before-final-fence changes and four races are written;
   the whole-page enrichment budget/concurrency work is not implemented.
5. Webhook/root owner: transaction port, processing use case and HTTP route
   restructuring are partial. Transaction-bound adapters, conflict-safe receipt
   insertion, outer composition, route fixtures and real PostgreSQL rollback/
   redelivery tests are not integrated. Keep remote preadmission outside that
   transaction and preserve old uncertain processing receipts.
6. Complete API root integration for explicit runtime database budgets and lazy
   catalog construction. Re-run the corrected published HTTP suites first, then
   the exact owner projects and the fault/E2E/CI stages above. A missing generated
   Prisma client, a skipped PostgreSQL test or an unavailable runner is a blocker,
   never evidence that the change works.
