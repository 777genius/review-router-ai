# Multi-user scale and recovery without process restarts

Date: 2026-11-27. Audited baseline: `5ab12e2d79a2d60351fd17cca871b32f3d039f13`.
Delivery: one PR, reviewed plan, parallel implementation by existing owner,
real failure/recovery qualification, and repeated independent review until no
confirmed critical finding remains. This is implementation authorization, not a
production deployment or permission to change another PR's scope.

## Combined webhook and recovery integration

The current integration uses the fenced production default from PR #1027.
It supersedes the unreleased transaction-port prototype recorded below at
`49c565ac35d13cf0ea1ec1ffe69c195d6ea5b327`. The former prototype's PostgreSQL
results remain historical evidence for that source; they do not qualify the
combined fenced implementation.

The integration retains the worker, Accounts, native catalog, database-budget,
bounded-reader and index changes from this PR. It also retains the current
retry/settlement and accepted-result recovery contracts from PR #1028 and both
provider-picker browser contracts from PR #1030. Owner integration
`1572026b30d4403e9161f308712404b09ed34b85` additionally includes the bounded
attested Native/Gateway request retry, its pinned SDK and its additive migration.
Preserve this integrated work while reviewing its new concurrency, authority and
producer/consumer boundaries. No production deployment is part of this task.

### Webhook ownership and retained failure contracts

- The default signed HTTP composition, durable claim, effect fence, terminal
  receipt and bounded recovery path come from PR #1027. There is one production
  default; the unused generic transaction port and its duplicate assembly are
  removed.
- Existing fenced installation, repository, setup, push, authorization, ingress,
  custody and actual COMMIT-response-loss checks remain authoritative. Exact
  duplicate completion succeeds; a live or unfenced historical attempt remains
  uncertain and must not be acknowledged as complete.
- Five focused signed-HTTP PostgreSQL scenarios retain the distinct earlier
  failure contracts: lost HTTP acknowledgement, lock-wait cancellation, actual
  backend termination, and installation deletion that observes an installation
  created while waiting for the scope lock. The backend-termination scenario
  also checks a brand-new installation for orphan workspace, actor, membership
  and outbox effects before retry.
  The additional case pauses an initial creation after its durable claim, lets a
  newer signed deletion finish, then verifies that the old owner cannot recreate
  any local state. Reuse the existing supersession predicate under the existing
  scope/row locks; initial App authorization retains its grant-revision rules.
- The legacy injected route keeps conflict-safe receipt insertion with
  `createMany({ skipDuplicates: true })` and exact-identity, processed-only
  duplicate acknowledgement. This preserves PR #1026's acknowledgement contract
  without catching a uniqueness exception inside a transaction. Its repository
  cases and the unfinished-delivery/privacy HTTP assertions remain covered.
- App-authorization refresh and reconnect uncertainty remains fail-closed.
  A prior prototype fixture expecting revocation during an in-flight refresh
  does not override the fenced authorization contract.

### Migration and qualification boundaries

The current application catalog contains 176 migrations: the shared baseline,
both latest-row indexes, all three webhook migrations and the separately owned
`000165_attested_model_request_retry`. Admission must validate the exact
checksum-bound complete groups and their supported combinations; a migration
count alone is insufficient. The receipt-order index still requires both
preceding webhook migrations. Partial, reordered, changed, duplicate and unknown
tails fail. Managed92, historical96 and the other frozen historical fixtures
remain unchanged. The earlier 175-migration source and qualification stay bound
to their recorded predecessor.

The integration includes the bounded empty-element Link parser and indexed
receipt-floor lookup from PR #1027 at `ebf7adcc`. Its migration suite captures the
actual production claim SQL and parameters for the 100,000-row PostgreSQL plan
regression. This source review does not replace execution of that final-source
gate.

The integration checkpoints received source review. The complete combined
source still requires its native formatting, strict TypeScript, existing unit
and PostgreSQL matrices, browser contracts, paired public Action recovery and
ordinary protected CI checks. Earlier results retain their original commit/tree
bindings. The first-owner follow-up has local whole-file results on the earlier
`ef1`/175-migration candidate: production HTTP/PostgreSQL 46/46 and repository
PostgreSQL 5/5, with an old-runtime negative control. Those results do not qualify
the current 176-migration/SDK composition. Reconcile final code before publishing,
then complete the ten selected automatic workflow families, the dedicated PG17
baseline/adversarial qualification, compiled Action cold recovery and joined
Native retry evidence. The Statistics followthrough workflow is included.
Do not record a queued, skipped, failed or unexecuted gate as a pass.
The joined fixture must use the unchanged producer URL/database-name contract;
keep its PostgreSQL password authentication through `PGPASSWORD`, without
weakening producer guards or changing the original private/public assertions.

For an eventual webhook rollout, retain the writer-drain, migration and
legacy-role grant requirements in the
[webhook deployment record](../deployments/2026-11-27-webhook-effect-fence.md).
Release selection and deployment remain separate.

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

| Existing PR                                       | Observed status             | Boundary retained in this work                                                                                                                                                                                                                          |
| ------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1007, `7f038195`                                 | Merged                      | OAuth/cache fencing, GitLab credential separation, bounded HTTP bodies, observation recovery, stable inventory quota, ruleset/outbox atomicity, pool acquisition deadline, Usage SQL/retention, workspace selection and Action streaming already exist. |
| #1003, #960, #920                                 | Merged                      | Preserve exact observation retries/deadlines, uncertain dispatch handling and progress pagination.                                                                                                                                                      |
| #998, #977                                        | Merged                      | Preserve owner extraction, current Foundation/Get Modular adoption and source boundaries.                                                                                                                                                               |
| #959                                              | Merged                      | Preserve native provider contracts; ReviewRouter does not copy native provider logic.                                                                                                                                                                   |
| #1008, `7681003e`                                 | Draft                       | Do not edit worker `review-v2-projection-envelope.ts` or `review-v2-publication-payloads.ts` and its test.                                                                                                                                              |
| #1020, `46e20e3d`                                 | Open                        | Do not duplicate `apps/web/src/features/provider-setup/setup-provider.ts` selector fix or its test.                                                                                                                                                     |
| #1017, `42d2cf28`                                 | Merged during qualification | Preserve the Gateway management ingress and deployment evidence from current main; no duplicate implementation.                                                                                                                                         |
| #1022, `ef062a48`                                 | Merged during final review  | Preserve the bounded stale-close capability recovery from main; qualify its interaction with catalog outages without replaying inference or extending expired authority.                                                                                |
| #1026, `78ed993e8603aa254ee5022b43564845aa11e540` | Open                        | Adapt only its exact-processed acknowledgement semantics to our conflict-safe transactional repository. Keep `createMany(skipDuplicates)` and exact failed reclaim; no takeover or old `create`/P2002 path.                                             |
| #1027, `7b536d6cd8ba4defad94035c42068abd3c5cd8fc` | Draft                       | Incomplete owner/generation/lease recovery remains excluded. Its separate `000165_webhook_effect_fence` would change our checksum-bound checkout172 tail; no migration or handler integration is absorbed.                                              |
| #1010, `c31ab0b8`                                 | Draft                       | Shared Identity/SCM plans own future identity/session/account migration.                                                                                                                                                                                |
| #474, `f4523cae`                                  | Draft                       | Offline custody envelope rebind and PG17 cutover remain separately owned.                                                                                                                                                                               |
| #1002, `021c7828`                                 | Draft                       | Full-root Markdown-reference adoption is not part of this PR.                                                                                                                                                                                           |
| #1015, `907bb607`                                 | Open                        | Main already includes its original formatting correction. Reuse only the independently checked four-line Usage fixture correction below, with attribution; do not merge the other PR or change report semantics.                                        |
| #869, #870, #864, #872                            | Draft                       | Homepage and video work excluded.                                                                                                                                                                                                                       |

Recheck open PRs and main before final integration. Normal additive index conflicts
do not justify absorbing other PRs. A later merge is not permission to overwrite
its semantics with the audited baseline.

The 06:38 UTC recheck found main at `fa690ad6ffc7769cbaa0ee80a5e18414eef1249d`:
four paths after integrated `d84feba7`, comprising three operations/deployment
documents and a three-line PostgreSQL needrestart override. No application,
migration or CI source changed; these host-maintenance additions are not required
for this Draft. PR #1021 had zero reviews, inline comments and review threads;
its two discussion comments reported Draft-review skipping and runner waiting,
not code findings. No bot action or unrelated merge follows from those comments.

The 09:15 UTC read found main and #1026 unchanged. Draft #1027 had advanced to
`7b536d6cd8ba4defad94035c42068abd3c5cd8fc`. Its later changes route several
installation, personal-workspace, repository/GitLab inventory and workspace-setting
writers through its new epoch protocol; subsequent work adds retry-budget and
App-identity binding. That protocol and its colliding migration165 remain excluded.
They are neither imported nor qualified by this Draft. No source integration or
rollout follows from this overlap observation.

## 3. Source findings and acceptance contracts

Scores are engineering judgments: complexity C (higher costs more), expected
reliability R within the stated scope, and diagnosis confidence U, all /10.
Handwritten production/integration LOC P and tests/fixtures LOC T exclude vendor,
generated bundles, lockfiles and documentation. Changed/deleted surrounding code
is reported separately in the final diff to avoid double-counting estimates.

| Workstream                           | Observed failure and intended correction                                                                                                                                                                                                                              |     P LOC |       T LOC | C/R/U  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------: | ----------: | ------ |
| A. Worker owner isolation            | `runWorkerBatch` is sequential: catching rejection does not release a permanently pending phase. Give known owners finite observation windows while retaining at most one real invocation per owner until settlement; healthy owners can run again.                   |   500–900 |   800–1,300 | 6/9/10 |
| B. Stop and claim lifetime           | The shutdown signal only gates the next outer batch; outbox continues claiming, and worker signal handlers use `once`. Stop new claims/phases on shutdown, drain already owned effects and keep repeated signals from restoring immediate termination.                |   250–500 |     450–750 | 4/9/10 |
| C. GitHub progress/inventory         | A never-settling cached `GET /app` promise and unbounded installation/client/request pagination can hold the serial worker. Bound the real transport and whole pass; preserve incomplete inventory and uncertain mutation semantics.                                  |   500–950 |   950–1,500 | 5/9/10 |
| D. Completion batch ownership        | `ScanDueReviewCompletionProcesses` uses fail-fast `Promise.all`; one rejection releases the caller while claimed siblings still execute. Await all owned settlements and report failures honestly, preserving exact claims and admission bounds.                      |   120–300 |     300–550 | 4/9/10 |
| E. Runtime database execution        | Pool acquisition is bounded, but acquired SQL has no server execution/lock budget. A locked query can occupy every connection indefinitely. Apply runtime-specific PostgreSQL budgets and narrow unavailable classification; prove recovery after timeout/disconnect. |   250–500 |   600–1,000 | 5/9/9  |
| F. Dashboard query scaling           | Installation sync status issues one query per installation. Replace it with a bounded latest-per-installation SQL read. Measure multi-parent nested latest-row reads and change only paths whose SQL actually hydrates unbounded history.                             |   380–810 |   700–1,350 | 5/9/8  |
| G. Native catalog recovery           | Startup discovery failure is caught, but three consumers freeze the empty catalog forever: relay, runtime snapshot and model-settings reader. Share a bounded refresh source for new admission, preserve pinned in-flight facts and local allowances.                 | 650–1,200 | 1,000–1,700 | 6/9/10 |
| H. Integrated failure qualification  | Exercise concurrent tenants, dependency loss/restore, delayed completion, stop and process recovery through the actual changed composition, reusing existing harnesses. Wire relevant strict/CI coverage and operational evidence.                                    |   150–350 |   650–1,200 | 5/9/8  |
| I. Atomic webhook receipts           | Delivery is committed as `processing` before separate effects; interruption leaves an unretryable receipt forever. Commit claim, local effects/outbox and processed receipt in one transaction, keeping external preadmission outside it.                             | 800–1,400 | 1,200–2,000 | 6/9/10 |
| J. Accounts/HTTP resource boundaries | Optional metadata awaits after the final inventory authorization fence; account enrichment can start 100 remote reads; one key route still reads unbounded JSON; non-2xx public-catalog bodies are left open. Fix these existing seams without extra auth layers.     |   250–500 |   650–1,100 | 5/9/10 |

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
   Each actual owner has one settlement notification; only the active pass may
   retain an observation callback. Remove it when the window ends. Repeated
   observation must not attach another reaction to a permanently pending owner.
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
Hold an owner across 100 expired windows as well: its native Promise reaction
count must remain bounded while the healthy outbox completes all 100 passes.
Keep the existing late-failure, recovery, one-shot and actual-drain assertions.

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
Only an exact already-processed receipt permits duplicate HTTP acknowledgement.
Historical processing, missing or mismatched receipts return the existing safe
processing error without changing their state; a successful response must not
hide unfinished work. This adopts the narrow #1026 correction without a new
lease/fencing protocol or a read on the successful fresh/retry path.

An error response does not schedule a GitHub retry: [GitHub does not automatically
redeliver failed webhooks](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks).
The atomicity guarantee makes a new failed local transaction safe to redeliver
through the existing GitHub App delivery controls. Historical uncertain receipts
still require effect investigation; this change does not introduce a replay worker.

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

| Stage                               | Owner                            | Deliverable / dependency                                                                                                                                 |
| ----------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Audit                            | Root + three read-only auditors  | Current source, open-PR matrix, concrete failures and test seams. Complete before plan review.                                                           |
| 1. Plan rounds                      | All reviewers                    | Challenge scope, uncertainty, resource/claim custody, security and integration. Root revises after each actual round.                                    |
| 2A. Worker isolation/adapters/drain | Runtime owner                    | A/B/C/D in existing worker/outbox/repositories/review-progress/review-processes owners, including worker root wiring.                                    |
| 2B. Database and reads              | Data owner                       | E/F in platform-db and selected existing read adapters; propose schema/index changes to root before mutation.                                            |
| 2C. Catalog and HTTP consumers      | Gateway consumer owner           | G/J in API native catalog/relay/composition/model-settings and Accounts/HTTP seams; coordinate app.ts wiring with root, no open-PR-owned selector edits. |
| 2D. Webhook atomicity/integration   | Root                             | I, shared composition integration, plan/deployment records and publication.                                                                              |
| 3. Fault integration                | Root + each owner                | H using real loopback dependencies and a fresh isolated PostgreSQL cluster; strict source projects and focused checks.                                   |
| 4. Cross review                     | Different owner than implementer | Review implementation/evidence, fix critical findings, repeat affected tests.                                                                            |
| 5. Final qualification              | Root                             | Main reconciliation, relevant complete CI/E2E, accurate Draft PR evidence and unresolved limitations.                                                    |

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
- Initial published HTTP checkpoint: `3cb28a1456d110215cf6ae0a35fc58e1881ae98d`
  bounds provider-key requests and public-catalog response cleanup. Independent
  review corrected its response-close test in `c9659a4`; the stronger assertion
  subsequently passed with all 18 HTTP cases on `e6095e3e`.
- Environment recovery: the interrupted checkout and every owner's source were
  recovered intact. The pinned dependency graph and Prisma client were restored.
  The exact optional subscription-runtime source `c7543bc716411a5f899a790a735d09ed2530f779`
  was built with the existing TypeScript 7.0.2 toolchain and its 64 exported
  artifacts verified in both installed peer contexts. No owner dependency or
  source version was replaced to make tests run.
- Published A/B/C/D/E checkpoint: `b63ff683148f2bbf7ecc7e2171883f5f6b4dd1bf`.
  Worker ownership, shutdown, completion settlement and GitHub transport suites:
  227 tests passed after correcting one duplicate-ID fixture. Runtime SQL and
  retained worker/SQL fault integration: 9 real PostgreSQL 17.10 tests passed.
  Explicit Prisma Web wiring and existing acquisition regression also passed.
  Shared strict TypeScript passed; larger native compiler processes were killed
  by the shared environment and are pending, not source passes or failures.
- Published J checkpoint: `bdb4ac8ff76546781fc175526a2cba4e4ce108aa`.
  Accounts enrichment/final authorization: 155 tests in 11 suites passed, including
  a 100-account real SDK/HTTP body stall, transport closure and subsequent page
  recovery without rebuilding the service. The three-second budget starts at
  optional remote enrichment; mandatory local authorization and final source
  fences remain outside it. Four concurrent row enrichments are a page-local
  bound, not a process-wide connection or render-latency guarantee.
- F conditional queries are confirmed by actual Prisma/driver SQL. For 20 parents,
  health and diagnostics each hydrated 4,000 history rows and policy hydrated
  2,000 versions. Latest-row readers now return 20 relevant child rows each;
  installation status returns 40 parents in one statement. Tenant, ties, nullable
  and empty cases plus a real RepeatableRead concurrent append passed. All 16
  focused tests passed on PostgreSQL 17.10, with all 172 migrations applied.
- Two measured F indexes are approved: `000165_installation_sync_latest_index`
  and `000166_repository_health_latest_index`. The actual installation query
  uses its partial index even under a forced generic prepared plan. A skewed
  health-history fixture justified the workspace/repository/latest-order index.
  Policy uses its existing version index; no speculative index was added.
- G source/model-settings passed 68 tests; the initial runtime-snapshot suite
  passed 90, adjacent authorization suites 37, and the final repository admission
  suite 11. The final suite proves rollback after later authority SQL, authorization
  insertion and outbox insertion cross the catalog TTL. Seven new relay recovery
  cases and one original HTTP case passed separately. The later complete relay189
  and snapshot91 result is recorded below; interrupted earlier runs are not passes.
- Cross-owner G review found TTL could expire during SQL after the first runtime
  fence. The existing authorization repository now checks a synchronous native
  freshness predicate after all new authorization/outbox writes. Expiry throws
  through the real transaction boundary; only the outer catch maps it to
  EligibilityChanged. Exact persisted replay bypasses this new-admission check.
  No HTTP, repeated SQL, recapture, wire field or lock-order change was added.
- I adapter regression: 102 existing tests in seven suites passed with the updated
  root-versus-transaction fixtures. Independent owners reviewed transaction joins,
  receipt identity, error privacy and the actual PostgreSQL COMMIT-loss proxy.
  A second review added concurrent push commit/abort cases to prove unique receipt
  fencing without the installation global lock masking that database boundary.
- Whole changed-source syntax ESLint passed for 131 files, and the architecture
  checker passed for 704 domain/application files. Full original TS7 configs passed
  for shared, platform-db, repo-health and support-diagnostics; remaining original
  projects are pending. No include set, test assertion or compiler was weakened.
- I implementation joins receipt, local handlers and outbox in one root transaction.
  Independent review found that wrapping every event in Serializable would change
  installation authority visibility after a scope-lock wait. The composition now
  preserves ReadCommitted for installation/auth/push and the existing Serializable
  retry boundary for PR/repository workflow authority. The global writer guard
  precedes receipt claims only for installation/repository events. A downgrade of
  repository isolation is rejected because concurrent workflow creation still
  needs its cross-table Serializable protection.
- I failure qualification covers actual signed HTTP, PostgreSQL rollback after
  each local stage, duplicate wait/abort, historical receipt identity, server lock
  cancellation, backend termination, scope-lock creation/removal and response loss.
  A separate PostgreSQL protocol proxy distinguishes a committed transaction whose
  acknowledgment was lost from one that rolled back. Executed results and the
  later acknowledgement correction are recorded below.

- Open-PR recheck: #1008 and #1020 retain their audited source and ownership.
  #1017 was merged into main at `42d2cf2850d4de525aea16a96ceb1a444e2e2e34`;
  its ingress and deployment evidence are preserved through normal branch merge.
  #1015 now has one four-line test-only correction against main at
  `907bb60730ba3bd38a1e288c6528143f6cdaada1`: filter facets contain provider/model
  identities, while billing metadata belongs to metrics and report rows. The
  legacy expected-report helper incorrectly added billing to facets. Independent
  SQL/builder review and byte-for-byte comparison approved reusing exactly that
  deletion to remove the known baseline qualification failure. All 20 PostgreSQL
  test bodies and complete report equality assertions remain unchanged; their
  successful real-PG rerun is recorded below. No production Usage change or merge
  of another PR is included.

### Final integration and migration admission review

- Main reconciliation: merge `bff69a97f559b345bfc8e770235a2adbc1c3851b`
  retains current main `42d2cf2850d4de525aea16a96ceb1a444e2e2e34` as its
  second parent. Independent comparison found seven incoming paths and only one
  overlap: the deployment index. Keeping main verbatim plus this task's entry
  resolves it without a runtime, workflow or migration conflict. The Draft is
  mergeable and the scoped diff remains 141 files, +10,297 / -1,391 at that merge.
- Release-admission review found the source catalog validators still admitted at
  most checkout170 despite the successful full migration experiment. The exact
  checkout172 tail now requires both new index names and checksums, then delegates
  to the unchanged checkout170 validator. Historical managed92, historical96 and
  the private rehearsal's 76-migration boundary retain their immutable contents.
  The concurrent indexes remain ordinary migration targets, excluded from the
  historical transaction-wrapped SQL and production additive window 105-110.
- Seven fixture owners are updated for checkout172 while retaining explicit
  predecessor170 and native-less169 coverage. Missing or altered index, incomplete
  171-row native-less catalog, unknown future migration and transactional-index
  admission all have negative assertions. No historical SQL or checksum changed.
  Initial remote preparation and literal comparison were source review only.
  The seven complete local suites are now recorded below; full CI and the
  dedicated PostgreSQL 17 release contract remain separate gates.
- Previous Draft PR run `45933520011` passed only the impact/aggregate control
  jobs; actual quality, static and PostgreSQL jobs were skipped. That green
  aggregate is not full qualification. Keep Draft status and require the actual
  manual full-tier jobs to finish successfully; no workflow condition is weakened.
- The environment returned with the checkout intact but without the temporary
  dependency store. On clean `29cbbe54`, the three changed legacy migration
  modules passed `node --check`, and 14 checks of their actual exported readers
  and partition functions passed using Node 24.22.3. These prove the new catalog,
  raw SQL checksums, unchanged historical catalogs and rejected partial or altered
  tails. They do not substitute for Vitest, strict TypeScript or PostgreSQL gates.
  The three legacy `.mjs` corrections remain local to existing catalog admission;
  migrating their full historical policy/rehearsal modules would expand this fix.
  Their JavaScript type-coverage gap remains explicit; new test code is TypeScript.

### Main integration: stale close capability

The live PR recheck found #1022 after the initial audit. Its source demonstrated
a separate pre-existing cleanup liveness defect: a retained client can keep
receiving a definite no-effect 401, while recovery refuses to replace an existing
session. Repeated cleanup then retains capacity. Catalog discovery is independent
of that failure, so the original G guarantee alone did not fix it.

Main now includes the reviewed `ef062a4828ab96aa8199ca2710328c9644da96af`.
Two independent source reviews approved the bounded recovery: only a parsed
401 `unauthenticated` / `not_dispatched` permits proving and reissuing the exact
original capability before the original deadlines. The same close ID and first
reason are retried once. Failed proof, an unknown effect and expired authority
retain their existing custody rules; no inference, new identity or general retry
is introduced. The original commit and deployment record are preserved by a
normal merge from main. The author's external fixtures are not our test results.

One additional integration case combines a native catalog outage with a single
definite 401, then uses the ordinary close fixture for the successful retry.
It must prove no extra catalog read or inference, unchanged preparation/close
identity and a closed native execution. The combined relay suite at that checkpoint expects
188 cases. This does not promise recovery of already expired capabilities or
establish the cause of the author's reported historical bearer refusals.

### Follow-up binding guard and qualification checkpoint

Main advanced to `d84feba7ae08cf477f5b0584e526971f38458c04`, preserving the
follow-up `6271ebe1f5e98bb376b4c7269394f806cb73041f` and its two deployment
records. The source delta is 12 preparation lines and one 30-line regression.
Independent reviews approved the ordinary merge: a stale canonical or saved
binding mismatch is rejected before consumer-control readback or reprepare;
the original operation, execution, account, epoch and deadline must agree.
This narrows stale refresh, preserves custody on refusal, and adds no catalog
dependency to cleanup. Our existing outage/401 case covers the positive path;
the incoming mismatch case covers the negative path. The combined suite contains
189 cases; its complete execution is recorded below.

The peer's 181 isolated tests and reported production installation of `6271ebe1`
remain attributed in the unchanged peer record. They are not qualification or
deployment of this Draft. No production operation was performed in this task.

| Qualification                              | Actual result and source                                                                                                                                                                                                                                                                                                            | Remaining boundary                                                                                                                                                                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public catalog HTTP and provider-key route | On `e6095e3e`, 18/18 passed, zero skips, including the corrected unfinished ServerResponse close assertion.                                                                                                                                                                                                                         | Real loopback response ownership and the existing 256 KiB route envelope.                                                                                                                                                                                       |
| Migration source admission                 | 382/382 cumulatively across seven complete files, zero skips: six files/252 cases on `e6095e3e`, then the unchanged private-rehearsal unit file/130 cases on `f1ccb8cb`.                                                                                                                                                            | Source/catalog validation only; this is not a live PostgreSQL upgrade, Docker rehearsal or release approval. Earlier 14 reader/partition and three syntax checks are separate evidence.                                                                         |
| Native relay / snapshot                    | On `f1ccb8cb`, full relay189 plus snapshot91 passed: 280/280, zero skips.                                                                                                                                                                                                                                                           | Includes the main binding guard and combined catalog-outage/401 close case; no production model inference was needed.                                                                                                                                           |
| Webhook unit/HTTP/adapters                 | On the late acknowledgement source, all ten complete files passed 122/122, zero skips, including all 13 repository cases.                                                                                                                                                                                                           | Fresh/retry paths avoid the extra read; only exact processed duplicates acknowledge.                                                                                                                                                                            |
| Actual webhook database boundaries         | On the same late source, PostgreSQL 17.10 applied all 172 migrations and passed 27 atomicity plus one COMMIT-loss case: 28/28, zero skips.                                                                                                                                                                                          | Real signed HTTP, unchanged receipt/effect transactions, historical uncertainty, identity rejection and exact processed duplicates. No takeover or production redelivery.                                                                                       |
| Installer fixture cleanup                  | On `f1ccb8cb` plus the cleanup patch, all 63 original cases passed, zero skips, in 46.724s. A separate forced shlock exit17 produced the expected original assertion failure; its child was already dead before supervisor cleanup. The same whole file passed 63/63 on clean `474b599b` under Node 26.11.1 in 49.578s, zero skips. | Original cleanup/fault proof: Node 24.22.3/Vitest 4.1.10; repeat on clean `474b599b`: Node 26.11.1. Original forks configuration and deadlines remain unchanged. The diagnostic selected only one case; it does not diagnose or pass the historical CI timeout. |
| Late source checks                         | On `e6095e3e`, 12 late JS/TS files passed ESLint/Prettier and incoming shell passed `bash -n`. The five late acknowledgement/fixture files also passed canonical formatting and ESLint.                                                                                                                                             | No lint warnings/errors; complete original strict projects and authoritative CI remain separate.                                                                                                                                                                |
| Usage fixture correction                   | On unchanged `f1ccb8cb` Usage/DB sources, all 20 tests passed against disposable PostgreSQL 17.10, zero skips, in 32.027s. The opt-in SQL qualification passed its six bounded-plan scenarios.                                                                                                                                      | Those six scenarios are included in the 20 tests, not additional tests. Full report equality and the exact four-line #1015 correction remain intact; the CI PostgreSQL 17.5 gate is separate.                                                                   |

The first actual webhook run on `f1ccb8cb` passed 23/24 cases, including COMMIT
loss, but failed while inserting an invalid fixture requirement
`account_gateway+codex` under the unchanged `WorkflowProvisioning_workflow_requirement`
constraint. Only the attempt and installed expectation were corrected to the
domain's canonical `gateway`; rollback, revision and duplicate assertions stayed
intact. Independent review then identified the retained baseline false-200
behaviour for historical processing/mismatched receipts. The narrow semantics
from #1026 at `78ed993e8603aa254ee5022b43564845aa11e540` were adapted to our
transaction-safe repository, and four additional real-HTTP/PG acknowledgement
cases joined the complete successful 28-case run above.

Late webhook results bind to `f1ccb8cb` plus the five working-tree source blobs in
`qualification-webhook-ack-checks.json` and `qualification-webhook-ack-postgres.json`,
including repository `1a12148f8d7d724bc1fc39d6af64a8eeb47e2c8d` and atomicity test
`a40722892b8d7d5c6a8c455b9889f9e0041848b7`; they are not clean-`f1ccb8cb` results.
Installer evidence binds to executed test blob `0543fe71d0b6b728c305ae54dd4af692668b909a`;
formatted candidate `d418d160861ff5bce083082dfcee72f43252cc4d` differs only by a
verified whitespace wrap. No assertion, test timeout or installer behaviour
changed. The new finally owns the spawned lock-holder even when setup assertions
fail, and no child remained after either diagnostic or normal run.

The restored pinned toolchain now completed canonical offline Prisma 7.9.0
generation inside a verified distinct rootless network namespace with no egress;
schema, lockfile, generation script and environment whitelist were unchanged.
The exact subscription-runtime `c7543bc716411a5f899a790a735d09ed2530f779` also
completed its canonical full build with TypeScript 7.0.2: all 3,136 dist files
were copied identically into both consumer contexts, with 64 export references
verified in each. Earlier isolation failures, SIGKILL and interrupted preparation
remain unsuccessful attempts; they are not retroactively passes or the evidence
for the later successful restoration.

### Strict corrections and current gate state

The first complete strict attempt stopped at 42 configurations passed, one failed
and 17 not run, with zero cache hits. The installation webhook discriminator was
split into its two existing literal members to fix TS2379 without a cast or runtime
change. Later strict checks required the runtime reader's existing `$queryRaw`
method in its type and a throwing implementation in the shared snapshot fixture.
A fresh graph reached 55 passed, one failed and four not run before finding the
worker child fixture's incomplete maintenance-result cast. That fixture now
returns the complete zero/empty disabled result with contextual typing. These
are separate attempts; their counts are not cumulative completion of all 60.

The original GitHub-installations, review-config and worker strict projects
passed after their corrections. The complete snapshot file passed 91/91 again
on runtime-reader blob `802722a0b0d741d3d375cd54778735d6e17dc8a2` and fixture
`e6957905be519430330b28c08db34fc684532abc`; this repeats the snapshot portion of
G280 rather than adding 91 distinct cases. All three original shutdown cases
passed with worker fixture `f431f9f6a02506a8b8fff158768290187daca48f`.
The Web timer now schedules the same callback immediately after its assignment
inside the synchronous Promise executor, fixing its optional-function type
without an assertion or changed deadline. That source is
`f72c9c83545020ff816374fb7d4b908576d2f43c`. On that corrected source, all 11
complete Accounts files passed again: 155/155, zero skips, in 9.511s, with unchanged
before/after source hashes in `qualification-j-account-enrichment-f1.json`.
Two full Web strict attempts were killed by SIGKILL without a TypeScript
diagnostic. The second used the native runtime's supported `GOGC=25` scheduling
and retained the same complete project and single checker. Its GC trace recorded
1,833 MB of live heap before termination; this does not establish the external
signal's cause. Those attempts remain unsuccessful. The complete original
strict graph subsequently passed all 60 configurations, including full Web, on
clean `474b599b611b32edf79f099dcce00b7fd7a8787b` in 256.006s. The 56 Turbo tasks
all executed with zero cache hits; the three trailing configurations and shared
build also passed. All 4,502 tracked non-Markdown inputs were unchanged. Native
TypeScript remained 7.0.2; no include set, checking option, assertion or deadline
was weakened. See `full-typecheck-474-recovery-20261127-coverage.json`.

Whole-repository ESLint passed on the source recorded in
`qualification-final-static.json`. Foundation's existing ownership map now
classifies the new adjacent public-catalog HTTP test; no allowed edge or exclusion
was broadened. Foundation and DEV_ONLY checks passed, while registry assertion
correctly rejected the environment's external package location. The exact locked
Foundation 3.1.0 was materialized inside consumer `node_modules`, with all 2,905
files and 12 dependency bindings verified against the frozen store. The unchanged
`foundation:assert-registry` then passed at 07:38:21 UTC. This restores the normal
environment layout; it changes no package bytes, lock, guard or local-mode policy.
The complete architecture command then passed every boundary stage, including
23 Memory positive/negative cases, six Statistics cases, history and metadata
layout, before its final metadata typecheck found two missing React type hoists
in the relocated environment. Restoring the two existing private bindings from
the frozen install metadata preserved all package versions and configuration;
the unchanged `metadata:typecheck` passed. The full original architecture command
subsequently passed in 193.896s on clean `1adc3da5`, whose tree is identical to
published `474b599b611b32edf79f099dcce00b7fd7a8787b`. Its command log survives;
the original receipt JSON was lost during the executor reset. This complete
command result is separate from the earlier component-only successes. Whole-repository Prettier subsequently passed with a
512 MiB formatter heap, and both final worker/Web files passed ESLint. The earlier
formatter attempt at 192 MiB exhausted its artificial heap limit and is not a pass.

Native Accounts run `45937901453` on `29cbbe54` finished with **failure** at
07:30 UTC. Step 8, the full Web TypeScript check, reported the webhook
discriminator, runtime-reader `$queryRaw` and optional timer callback diagnostics
above. All browser, Chromium, 40-screenshot, flow and role-visibility steps were
skipped. There is **no browser E2E evidence** from that run. An unchanged route or
browser harness cannot make this failed preflight a browser pass; the Web strict
project also reaches API types. The corrected source requires a new successful
Native qualification with its own exact-source binding.

Manual full CI `45937669312` (`29cbbe54`), `45940187687` (`e6095e3e`) and
`45948041513` (`f1ccb8cb`) still lack final completion evidence at this checkpoint.
The older Linux installer job `140316711863` reached Vitest and exceeded its
10-minute job limit; the official annotation confirms that boundary, not a
testcase or narrower cause. The local precollection SIGKILL did not reproduce
that timeout. The later clean-`474b599b` Node 26.11.1 run passed all 63 cases in
49.578s, with zero skips, unchanged source hashes and no remaining child process.
Neither it nor the earlier cleanup-patch run changes the historical job's
cancelled outcome. Earlier runs bind only to their recorded older heads.
Full CI `45963536826` and Native `45963033128` bind to `474b599b` and must be
reported from their own actual results. Workflow conditions and deadlines remain
unchanged. Final-source full CI, dedicated PG17 and Native qualification remain
required, separately from any aggregate status.

### Canonical Action artifact correction

Source/Certification job `140316712053` on old `29cbbe54` exposed a real stale
`conflict-runtime.cjs`. The unchanged byte-parity check reproduced that failure
on `474b599b`. Rebuilding in the external local pnpm layout also exposed an
environment-only Codex wrapper-path difference; that output was discarded.
A first isolated dependency copy stopped with SIGKILL before building and remains
an unsuccessful preparation attempt. A fresh normal frozen install on the same
filesystem as the pnpm store used ordinary hard links and completed successfully.

On an isolated checkout of exact `474b599b`, with normal `node_modules/.pnpm`,
the original `pnpm action:build` passed in 9.433s and
`pnpm action:artifact:check:smoke` passed in 10.317s under Node 26.11.1. The pinned
SDK's 3,136 dist files were verified in both consumers; Prisma 7.9.0 was generated
through the unchanged offline guard in a verified network namespace without
egress. All 5,034 tracked files remained unchanged except `conflict-runtime.cjs`.
Codex `index.cjs`, its archive/manifest, dependency pins, builders and checkers
are byte-identical to the published source.

The corrected artifact is SHA256
`9123033425b72b4e9df8a6b5352c2e4dd7cc0e3d83c93ed2c8fd462226505dab`.
Independent review found only 88 changed bytes in 71 unused minified declaration
identifiers: restoring those tokens recovers the preceding artifact byte for byte.
No string, operation, branch, request, error or authorization behavior changed.
Both complete CLI/workflow test files passed 5/5 with zero skips in 3.427s. The CLI
test actually executes the standalone bundle without workspace dependencies and
checks fail-closed preflight and intentional stale-byte rejection. Evidence is
`action-canonical-qualification-474.json` and `action-canonical-behavior-474.json`.
This generated correction requires its own published-source CI; the local smoke
does not claim a binary release or replace the complete Source/Certification job.

An additional independent review of the ten late runtime/type/fixture files found
no critical regression. It specifically preserved child exit/error ownership,
the timer's original deadline, raw-query typing, exact processed acknowledgement,
bounded transaction retry, and the original fixture assertions. The generated
artifact received the separate review above. Remaining CI findings are evaluated
against their actual source; older already-corrected diagnostics are not new bugs.

### Remaining qualification and review gates

The final independent cross-boundary review found one additional P2 in
`worker-batch.ts`: a new `Promise.all` on each continuous pass retained another
reaction on the same unresponsive owner after the observation deadline. The
correction gives each owner a constant notification that reads one removable
current callback. It introduces no registry, polling, cancellation claim or
production diagnostic API. One-shot ordering, actual drain and once-only result
consumption retain their existing implementations. A 100-pass regression checks
native Promise subscription identities and independent outbox progress. An
exact-source Node type-stripping reproduction measured 100 subscriptions before
the correction and one afterward; this is runtime reproduction, not a strict
compiler or complete test-suite result. Two independent reviews accepted the
source correction.

The restored frozen dependency install passed on Node 24.22.3/pnpm 11.28.7 in
112.758s with unchanged package and lock inputs. Local preparation then failed:
running the engine package's postinstall through its own directory triggered an
implicit pnpm install terminated by SIGKILL; an ordinary root engine rebuild
returned zero, but the subsequent original offline Prisma generation in a
verified isolated network namespace was also terminated by SIGKILL. The external
cause is unconfirmed, and the executor subsequently became unavailable. No
worker Vitest or strict pass is claimed from these attempts. Original complete
worker test files, strict compiler, formatter and final CI remain mandatory.
The reviewed correction can be published to the existing Draft for those
ordinary CI gates; qualification and release remain pending until they pass.

Native browser run `45974106641` on `1388559a` completed with failure. Its strict
preflight, fixture and immutable-reader rollback passed, and artifact inspection
confirmed 40 unique captured screenshots. Three interactive flows timed out on
the removed Provider combobox; subsequent manifest assertion and role-visibility
steps were skipped. Commit `e1ed96f2b866d1e874d155bf46ab62335fcf94d2` corrects
only the shared harness and three screenshot callers to use the visible Provider
radio cards, with an exact Claude Code choice. All credential, persistence and
readiness assertions remain intact. E1 Native `45997885217` and full CI
`45997217875` retain their own source-bound results; no pending run is a pass.
The PR verification record tracks terminal outcomes and the subsequent worker
correction without requiring a documentation-only CI restart.

The 12:25 UTC overlap snapshot observes main at
`7aaf95c30211d2cf9147ea450fc84282ebd0f7da`, with only operations/deployment
changes after integrated `d84feba7`. Ready PR #1027 is now
`882dee1b20920b2f7a44a230a5877fef9eb5a515`: its current six-family fenced
webhook protocol replaces the earlier epoch experiment, has separate migrations
and explicit operator recovery, and adds the same COMMIT-loss fixture path.
That separately owned protocol remains excluded; later integration must
reconcile the shared paths deliberately. Earlier dated observations above
retain their historical meaning.

1. Preserve the executed G280, I28/122, Usage20, installer63 and migration382
   source bindings when publishing the late patch. Rerun affected boundaries if
   those sources change; earlier counts do not qualify a different implementation.
2. Preserve the clean-`474b599b` full-60 result and same-tree whole architecture
   result; finish each still-unqualified required boundary and rerun affected
   checks when its source or inputs change. Use one heavy local process at a time.
   Resource-killed processes and skipped tests remain unsuccessful attempts.
3. Repeat independent implementation review, resolve concrete critical findings
   and rerun the affected tests. Preserve unknown commit/effect and replay fences.
4. Reconcile live main/open PRs and wait for authoritative checks on the final
   published head. Queued or running checks need normal waiting, not bypasses.
5. Publish the final source-bound verification and rollout record, with actual diff
   size and limits. Draft status and later deployment remain separate decisions.
