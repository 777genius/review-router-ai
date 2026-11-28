# Scale and recovery: deployment

- Task ID: `2026-11-27-scale-and-recovery`.
- Goal: bounded resource use and recovery from component failures without
  restarting otherwise healthy services.
- Affected targets: API, Web, ordinary worker, skill worker and PostgreSQL indexes.
- Implementation: [PR #1021](https://github.com/777genius/review-router-ai/pull/1021).
- Source checkpoints: worker/database `b63ff683148f2bbf7ecc7e2171883f5f6b4dd1bf`;
  Accounts `bdb4ac8ff76546781fc175526a2cba4e4ce108aa`;
  latest-row readers `d86e501a7c63e748596f4983d336d86868fe5f3f`;
  native catalog and webhook `dc9f0cd8cae93fff46044a4a8e2c4b2ac4b1c222`.
  The published integration checkpoint is
  `474b599b611b32edf79f099dcce00b7fd7a8787b`, tree
  `d7639a12a99dd61367a4bc05a4ca28ed0fc0b846`; the generated artifact correction
  below is qualified separately. Earlier checkpoint and patch-source results
  retain their original bindings. This Draft has not been merged into main,
  released or installed.
- Final main dependency: preserve the merged stale-close capability correction
  `ef062a4828ab96aa8199ca2710328c9644da96af` and its
  [separate deployment record](2026-11-27-relay-stale-close-capability.md).
  Preserve the follow-up binding guard `6271ebe1f5e98bb376b4c7269394f806cb73041f`
  from main `d84feba7ae08cf477f5b0584e526971f38458c04`. The peer reports its own
  production installation; this Draft remains uninstalled. The combined relay189
  and snapshot91 locally passed on `f1ccb8cb`, including catalog-outage/401 recovery.
- Historical overlap review (before the current integration below): adapt only acknowledgement semantics from open
  [#1026](https://github.com/777genius/review-router-ai/pull/1026) at
  `78ed993e8603aa254ee5022b43564845aa11e540`, preserving our conflict-safe
  transaction. At 09:15 UTC Draft #1027 had head
  `7b536d6cd8ba4defad94035c42068abd3c5cd8fc`; its later changes route existing
  installation, personal-workspace, repository/GitLab inventory and workspace-setting
  writers through its new epoch protocol, with retry-budget and App-identity
  binding work. That protocol and its separate migration165 remain excluded;
  this Draft neither imports nor qualifies them. Main `fa690ad6ffc7769cbaa0ee80a5e18414eef1249d` adds only three
  operations/deployment documents and a PostgreSQL needrestart override after
  `d84feba7`; no application/migration/CI integration is needed for those changes.
- Dependencies: preserve the already merged
  [multi-tenant reliability work](2026-11-25-multi-tenant-reliability.md);
  complete exact-head qualification before release selection.
- Last updated: `2026-11-27`.

## Current integration status

The batch is ready for review and includes owner integration
`1572026b30d4403e9161f308712404b09ed34b85` of PRs #1026, #1027, #1028 and #1030. The current default webhook implementation is the durable fenced
processor from PR #1027. It supersedes this PR's unreleased generic webhook
transaction-port prototype and its old default-composition test harness.

The distinct interruption, cancellation, HTTP-response-loss, lock-visibility and
supersession invariants are retained in five focused cases against the production
composition. Existing fenced and actual COMMIT-loss suites remain present.
Historical passes below stay bound to their recorded source and are not passes
for the combined tree.

The follow-up checks supersession before first-generation installation and
repository effects as well as lease takeovers. Claim and effect commit separately,
so a newer deletion must prevent an already admitted older creation from
recreating local state. Initial GitHub App authorization retains its separate
grant-revision rules. The added production HTTP/PostgreSQL regression pauses after
the first claim commits, completes a newer signed deletion, then resumes the older
creation and verifies that no installation, workspace, actor, owner or sync job
was created. Existing fault cases keep their cleanup and assertions intact.

The companion-stream follow-up preserves a successfully settled result when the
downstream reader cancels while settlement is finishing. Once both settlement
writes complete, a subsequent stream-close failure must not append another
unknown outcome. The one-line guard and strengthened existing cancellation case
are already present in the owner integration, including the bounded correction
from peer commit `f314ce865a2e367721a04476d501063fea57fb77`. The owner's separate
SDK, retry-protocol and migration additions remain intact. Their runtime
qualification is required on the published combined source.

The Skills browser preparation now drains the already selected setup client
scripts before authenticated database-backed rendering, inside the same existing
120-second warmup deadline. Authentication, HTTP readiness checks, browser cases
and scenario timeouts are unchanged. The earlier
[c40 Skills job](https://github.com/777genius/review-router-ai/actions/runs/46047996280/job/140671979594)
failed during warmup before executing any browser cases; that run is not a
browser pass and does not prove the follow-up works.

### Local webhook follow-up qualification

The local follow-up was checked against parent
`ef1dae17ece4c1d702c50a0711b83236205f5284`, with runtime blob
`bd6c78f7ed91b1fd38abb66ede03b2d25e3434d0`, production-test blob
`a7319b61c89511d253c026dbb3a4b6148ba0fb5e` and repository-fixture blob
`0bc61aed7184ee1313294ec81ff23c9a634709ba`.

- Whole production HTTP/PostgreSQL file: **46/46 passed**, zero skips/todo,
  Vitest duration 17.00 seconds.
- Whole repository PostgreSQL file: **5/5 passed**, zero skips/todo,
  Vitest duration 1.42 seconds.
- Original runtime negative control: the new race case failed with HTTP 200
  instead of the required 500. The other 45 cases were intentionally filtered
  from that diagnostic run; it is not a successful whole-file qualification.
- Node 24.22.3, pnpm 11.28.7, Vitest 4.1.10 and PostgreSQL 17.10. The green run
  used a fresh cluster, real Asia/Tokyo sessions, all 175 finished migrations and
  the production fixture's comparison of every migration name/checksum.
  Both owned TCP clusters stopped normally and the corrected source was restored.
- Guarded Prettier checked the original four follow-up files; baseline ESLint
  checked all three TypeScript files with zero warnings. The later owner integration and this follow-up require their own combined CI.

The first Unix-socket startup and reuse of one cluster for a second fresh
database were failed setup attempts. The latter was rejected by the unchanged
`000079` partial-role guard; the passing run used a new cluster without altering
SQL or authority roles. Two interrupted dependency restores also remain failed
attempts; the subsequent frozen installation completed with unchanged manifests.
An independent reviewer verified the raw test reports, log hashes, code blobs
and cleanup. Local receipt SHA256:
`f1f286bb1433b04f81864c8f9685da32c5d0d901fc8ec86fe44d58e8f96a6750`.

These isolated HTTP/SQL results use synthetic GitHub events. They do not replace
the full combined-source CI, native/browser checks or a separately authorized
deployment. The PR's current qualification record owns subsequent CI results.

Both latest-row indexes remain in the application catalog together with all three
webhook migrations and `000165_attested_model_request_retry`: 176 ordinary
migrations in total. The additive receipt-order
indexes from `000168` are included without modifying earlier SQL or managed92 and
historical96 manifests. Only the exact complete earlier groups and their complete
extensions/unions are admitted; the new index alone is rejected. The conflict-safe
legacy receipt repository still acknowledges only an exact processed delivery,
preserving PR #1026's unfinished-delivery behavior.

The bounded Link parser and indexed receipt-floor lookup from PR #1027 at
`ebf7adcc` are integrated. Its actual-query, 100,000-row plan regression remains
part of the required combined-source PostgreSQL gate; no runtime pass is inferred
from this source integration.

The owner integration also pins Action
`b222791515278dc92af6cb0eaa982afd73d0332d`, Native
`f6e05bf458fc447fb641b786d3ec911c592a18ec` and Gateway
`90739814c9e85fcf3ac9e9e6a0b2ea68b3131d28` for the bounded attested request
retry. The final review must preserve authority, lease, attempt and no-duplicate
effect boundaries across those exact producers and the consumer. The existing
Statistics followthrough browser gate is now selected as well. Earlier
175-migration and older-producer passes retain their original source bindings.

Source review also found that the new joined Native fixture supplied a password
in URLs rejected by the pinned producers, and a Gateway database name/query that
did not meet its fixture contract. The correction keeps the password-authenticated
disposable PostgreSQL service, passes its credential through standard
`PGPASSWORD`, and uses the producers' existing passwordless URL and database-name
contracts. Producer guards, images, pins, timeouts and acceptance assertions are
unchanged. The private/public joined qualification still must execute on this
corrected source.

The new webhook case is ported unchanged onto the owner's updated production
fixture, preserving its initialized deferred-request cleanup. The published
production-test blob therefore differs from the earlier local `a7319b61`
fixture; current combined-source PostgreSQL qualification remains mandatory.

Combined-source native checks and ordinary protected CI remain required. The
source reviews and retained historical evidence below do not replace current
runtime qualification. See the
[updated integration plan](../plans/2026-11-27-scale-and-recovery.md#combined-webhook-and-recovery-integration)
for the invariant and test mapping.

Before a separately authorized webhook rollout, follow the
[webhook writer-drain and grant procedure](2026-11-27-webhook-effect-fence.md)
in addition to this record's index/API/Web/worker procedure. No staging or
production rollout was performed by this merge task.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step                                                     |
| -------------------- | --------- | ------------------------------- | ------------------- | ------------------------------------------------------------------------ |
| staging              | `pending` | Not verified                    | Not verified        | Complete qualification, then separately authorize release.               |
| production           | `pending` | Not verified                    | Not verified        | No rollout attempted; use the release process and exact selected source. |

Pending means no verified completion is recorded, not an observation that an
installation is absent. Use the [status contract](README.md#status-contract).

## Applicability and prerequisites

The batch changes existing runtime boundaries. It adds no service, queue, feature
flag, provider protocol, customer configuration or credential migration.

| Area                                | Resulting behavior                                                                                                                          | Operational bound                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker phases                       | An unresponsive owner keeps its actual in-flight slot while independent owners continue. Stop prevents new claims and drains admitted work. | Observation timeout never authorizes repeating an uncertain effect. One-shot ordering is preserved.                                                                  |
| GitHub reads/progress               | Real App/token/body transport and whole-pass deadlines; complete inventory is required before reconciliation.                               | Failed inventory cannot imply repository deletion. Ambiguous mutations retain reconciliation semantics.                                                              |
| Runtime PostgreSQL                  | Explicit runtime clients use server statement and lock timeouts.                                                                            | 30-second statements and 5-second lock waits; administrative and injected clients retain their existing policy.                                                      |
| Dashboard reads                     | Latest-per-parent SQL avoids historical child hydration and installation N+1.                                                               | Tenant filters and stable latest-row ordering remain explicit; no retention deletion.                                                                                |
| Native catalog                      | One recoverable source serves new admission, settings and relay.                                                                            | 30-second success TTL, one-second failure cooldown, existing ten-second SDK transport; captured admission identity/policy stays immutable.                           |
| Retained close capability from main | A definite no-effect 401 can refresh only the original capability and retry the same close identity.                                        | Existing operation/binding proof and deadlines remain mandatory; expired or uncertain effects are not released by a timeout.                                         |
| Webhook receipts                    | Receipt, local authority effects and outbox commit together; only exact processed duplicates acknowledge successfully.                      | Independent preadmission stays outside. Historical uncertain processing and mismatched receipts stay unchanged and return a safe processing error, without takeover. |
| Accounts/HTTP                       | Optional enrichment shares a bounded window before final authorization; rejected body resources close.                                      | Three-second optional remote window, four row enrichments per page; neither a total render SLA nor a process-wide cap. Provider-key envelope remains 256 KiB.        |

Read the [implementation plan](../plans/2026-11-27-scale-and-recovery.md) for
acceptance contracts and the excluded open-PR ownership. All 60 original strict
configurations passed on clean `474b599b` in 256.006s; the whole architecture
command passed in 193.896s on the identical `1adc3da5` tree. Authoritative CI and
Native E2E retain their separate source requirements. Local qualification is not
release approval.

## Additive database migrations

| Migration                               | Definition and justification                                                                                                                                                            | Application compatibility                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `000165_installation_sync_latest_index` | Concurrent partial index on OutboxEvent aggregate ID, descending creation time and ID, limited to installation sync v1. Actual production SQL uses it under generic prepared plans.     | Existing writers and old readers remain compatible.                      |
| `000166_repository_health_latest_index` | Concurrent index on health-report workspace, repository, descending received time and ID. A skewed hot-repository fixture showed avoidable history scanning with the older access path. | Existing readers/writers remain compatible; older useful indexes remain. |

Each migration contains a single `CREATE INDEX CONCURRENTLY` statement and uses
ordinary immutable migration history. Both were applied by the actual migration
runner in a fresh PostgreSQL 17.10 cluster (172 total migrations). No historical
migration or checksum was edited. The complete application schema, not a reduced
fixture schema, is used in the PostgreSQL tests.

Index builds consume disk and I/O and can wait on existing transactions even
though concurrent creation avoids blocking ordinary table writes. Use the normal
migration/release budget, inspect actual build progress and available capacity,
and resolve any interrupted invalid index through the established migration
procedure before retrying. Do not silently mark an unapplied migration successful.
Runtime SQL deadlines do not change the administrative migration client.

Release-admission validators accept the exact checksum-bound checkout172 tail and
then reuse the unchanged predecessor validation. Both indexes stay excluded from
managed92/historical96 transaction SQL, the private rehearsal's historical76, and
the production additive migration window 105-110. Historical migration bytes and
manifests remain immutable. This source update still requires successful full CI;
the earlier fresh-cluster migration pass alone does not qualify every release gate.

## Ordered rollout

1. Complete independent review, strict checks, real PostgreSQL/HTTP/worker failure
   qualification and authoritative CI on the exact selected source.
2. When a release is separately authorized, reconcile that source and unfinished
   deployment tasks through the [release process](../operations/07-environments-and-release-management.md).
3. Apply migrations 165 then 166 through the normal migration gate. Verify both
   indexes exist and are valid before relying on their query scaling behavior.
4. Drain old workers and roll API/Web/worker through the ordinary release path.
   An old process does not acquire the new shutdown behavior until replaced.
5. Verify actual versions and applicable behavior below, then record environment,
   operator, time, source, image and evidence. This task does not authorize rollout.

## Verification and completion

### Final bounded-observation and browser follow-through

A final independent review reproduced an increasing number of Promise reactions
when continuous worker passes repeatedly observed one indefinitely pending owner.
The correction keeps a constant notification on each actual owner and one
removable callback for the active observation window. The added 100-pass
regression also requires one SDK invocation and 100 healthy outbox completions;
existing late-failure, one-shot and drain contracts remain unchanged. Two source
reviews accepted this correction. The exact-source Node reproduction changed
from 100 retained subscriptions to one; full-file tests and the original strict
worker project remain separate required qualification.

The frozen dependency restoration succeeded with unchanged package/lock inputs.
Subsequent local engine preparation and offline Prisma generation did not
complete successfully; the latter child ended with SIGKILL after its actual
network isolation was verified, and the executor became unavailable. Neither
attempt provides worker test or strict evidence. The source-reviewed correction
remains subject to the ordinary original CI gates before this Draft is qualified.

Native run `45974106641` on `1388559a` passed strict preflight, fixture and
immutable-reader rollback, then produced 40 captured screenshots but three
failed interactive flows. All three failed at the obsolete Provider combobox.
Manifest assertion and role-visibility steps were skipped. The shared harness
correction is published as `e1ed96f2b866d1e874d155bf46ab62335fcf94d2`, with no
product, workflow, deadline or assertion weakening. Its Native run `45997885217`
and full CI `45997217875` were queued at the 12:40 UTC checkpoint. The PR body
records later exact-source outcomes; these attempts are not deployment evidence.

At 12:25 UTC main was `7aaf95c30211d2cf9147ea450fc84282ebd0f7da`, with only
operations/deployment changes after the integrated base. Ready PR #1027 at
`882dee1b20920b2f7a44a230a5877fef9eb5a515` has replaced its earlier epoch
experiment with a separate fenced webhook protocol and explicit recovery.
It remains excluded and now shares an independently added COMMIT-loss test path
that requires deliberate reconciliation on any later integration.

### Earlier executed qualification

| Local evidence                                      | Observed result                                                                                                                                                                                                                                                                                                                      | Exact limit of the evidence                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker ownership, shutdown, completion, GitHub HTTP | 227 focused tests passed after one duplicate-ID fixture correction.                                                                                                                                                                                                                                                                  | Local transport/process fixtures, no customer GitHub mutations.                                                                                                                                                                                                 |
| Runtime SQL plus worker/SQL integration             | 9 actual PostgreSQL 17.10 tests passed.                                                                                                                                                                                                                                                                                              | Server cancellation, lock wait, disconnect and subsequent pool recovery; no throughput SLA.                                                                                                                                                                     |
| Accounts enrichment and final fences                | After the timer correction, all 11 complete files passed again: 155/155, zero skips, in 9.511s; actual SDK/HTTP 100-account stall/recovery remains covered.                                                                                                                                                                          | Fresh source-bound receipt preserves identical before/after hashes. Final local authorization remains mandatory beyond the optional remote budget.                                                                                                              |
| Latest-row readers and migrations                   | 16 tests passed; full 172 migrations applied, including both new indexes.                                                                                                                                                                                                                                                            | Driver SQL/rows, tenant and empty cases, ordering and real concurrent snapshot. Timings are synthetic.                                                                                                                                                          |
| Migration source admission                          | 382/382 cumulatively across seven complete files, zero skips: 252 on `e6095e3e` plus unchanged private-rehearsal unit file130 on `f1ccb8cb`.                                                                                                                                                                                         | Source/catalog validation, not a live PG upgrade or private Docker rehearsal. Full release gates remain separate; original assertions/configs retained.                                                                                                         |
| HTTP catalog body and provider-key envelope         | On `e6095e3e`, all 18 tests passed without skips, including the corrected unfinished-response close assertion.                                                                                                                                                                                                                       | Real loopback transport recovery and the existing 256 KiB request limit.                                                                                                                                                                                        |
| Native catalog                                      | On `f1ccb8cb`, both complete files passed: relay189 plus snapshot91, 280/280 with zero skips.                                                                                                                                                                                                                                        | Includes the main binding guard and catalog-outage/401 close interaction; no paid-model or production inference qualification is claimed.                                                                                                                       |
| Atomic webhook and exact acknowledgement            | On the late source, 122/122 unit/HTTP/adapter cases in ten files passed, including repository13; PostgreSQL 17.10 passed atomicity27 plus COMMIT-loss1, 28/28 with zero skips.                                                                                                                                                       | Full 172-migration schema; historical uncertainty and mismatched identity are rejected, exact processed duplicates acknowledge without repeated effects. No recovery lease or production redelivery.                                                            |
| Usage fixture correction                            | On unchanged `f1ccb8cb` Usage/DB source, all 20 tests passed on PostgreSQL 17.10, zero skips; opt-in SQL qualification passed six bounded-plan scenarios.                                                                                                                                                                            | The six scenarios are included in those 20 tests. Exact four-line #1015 correction and full report equality retained; CI PG17.5 remains separate.                                                                                                               |
| Installer fixture cleanup                           | On `f1ccb8cb` plus the cleanup patch, the original full file passed 63/63, zero skips, in 46.724s. Forced shlock exit17 separately failed the original assertion as expected, with the child already dead before supervisor cleanup. The same whole file passed 63/63 on clean `474b599b` under Node 26.11.1 in 49.578s, zero skips. | Original cleanup/fault proof: Node 24.22.3/Vitest 4.1.10; repeat on clean `474b599b`: Node 26.11.1. Original forks configuration and deadlines remain unchanged. The diagnostic selected only one case; it does not diagnose or pass the historical CI timeout. |
| Late source checks                                  | On `e6095e3e`, 12 late JS/TS files passed ESLint/Prettier and shell syntax passed. The five later acknowledgement/fixture files also passed canonical formatting and ESLint.                                                                                                                                                         | Zero lint warnings/errors; complete original strict projects and CI remain separate.                                                                                                                                                                            |
| Late strict corrections and affected regressions    | Original GitHub-installations, review-config and worker strict projects passed; the corrected snapshot file passed 91/91 again and all three shutdown cases passed.                                                                                                                                                                  | All 60 original strict configurations, including full Web, subsequently passed on clean `474b599b` in 256.006s. Earlier failed/killed attempts remain separate; repeated snapshot/shutdown cases are not additional totals.                                     |
| Native browser and authoritative CI                 | Native run45937901453 failed Web preflight on old `29cbbe54`; every browser/flow/visibility step was skipped. Full CI45963536826 and Native45963033128 bind separately to `474b599b`; the artifact correction needs its own final-source checks.                                                                                     | No browser E2E result exists from that run. Queued/running/skipped or resource-killed checks are not successful completion.                                                                                                                                     |

The first real webhook run passed 23/24, including COMMIT loss, but rejected an
invalid fixture requirement `account_gateway+codex` under the unchanged database
constraint. Only its attempt/installed literals were corrected to canonical
`gateway`; rollback, revision and duplicate assertions were preserved. The later
28-case pass includes the separate acknowledgement correction and four additional
real-HTTP/PG cases, not a relabelled first run.

Late results bind to `f1ccb8cb` plus the five source blobs recorded in
`qualification-webhook-ack-checks.json` and `qualification-webhook-ack-postgres.json`;
the repository is `1a12148f8d7d724bc1fc39d6af64a8eeb47e2c8d` and its real-PG
atomicity test is `a40722892b8d7d5c6a8c455b9889f9e0041848b7`. Installer execution
used blob `0543fe71d0b6b728c305ae54dd4af692668b909a`; the formatted candidate
`d418d160861ff5bce083082dfcee72f43252cc4d` differs only by a verified whitespace
wrap. These are patch-source results, not clean-`f1ccb8cb` qualification.

Canonical offline Prisma 7.9.0 generation subsequently succeeded in a verified
distinct rootless network namespace with no egress and unchanged schema,
lockfile, script and environment whitelist. The exact pinned subscription-runtime
`c7543bc716411a5f899a790a735d09ed2530f779` completed its full canonical TS7 build;
all 3,136 dist files match in both consumers, with 64 export references checked in
each. Earlier SIGKILL/isolation failures and interrupted preparation remain failed
attempts, separate from this successful restoration.

Strict corrections retain the original contracts: split the installation event
discriminator; declare the runtime reader's existing `$queryRaw` and provide it
in the shared fixture; return the worker fixture's complete disabled maintenance
result; schedule the same Web timer inside its synchronous Promise executor.
The first full attempt ended at 42 passed/1 failed/17 not run; a later fresh graph
ended at 55/1/4 before the worker fixture correction. Neither is full completion.
Snapshot91 repeated successfully on reader blob
`802722a0b0d741d3d375cd54778735d6e17dc8a2` and fixture
`e6957905be519430330b28c08db34fc684532abc`; shutdown3 passed with fixture
`f431f9f6a02506a8b8fff158768290187daca48f`. Web timer blob
`f72c9c83545020ff816374fb7d4b908576d2f43c` has independent source review and a fresh
155/155 pass across all 11 Accounts files in 9.511s, with zero skips and unchanged
source hashes in `qualification-j-account-enrichment-f1.json`. Earlier full Web
attempts were interrupted by SIGKILL without a TypeScript diagnostic. The complete
original 60-configuration strict graph subsequently passed on clean
`474b599b611b32edf79f099dcce00b7fd7a8787b` in 256.006s, including full Web.
It used native TypeScript 7.0.2, zero cache hits and unchanged 4,502 tracked
non-Markdown inputs. The successful run does not change the earlier outcomes.

Whole-repository ESLint passed on the recorded late source. Foundation and
DEV_ONLY checks passed after classifying the adjacent public-catalog HTTP test
in the existing ownership map, without widening edges or exclusions. The registry
guard correctly rejected an external environment package path. Materializing
the same locked Foundation 3.1.0 inside consumer `node_modules` preserved all 2,905
verified files and 12 dependency bindings; the unchanged registry assertion then
passed at 07:38:21 UTC. No guard, pin or local-mode policy changed. The complete
architecture command subsequently passed all boundary phases, including the
23 Memory and six Statistics cases. Its final metadata typecheck exposed two
missing declared React type hoists in the relocated environment. After restoring
those exact bindings, the unchanged metadata typecheck passed. The full original
architecture command subsequently passed in 193.896s on clean `1adc3da5`, with the
same tree as published `474b599b`. Its command log survives, but the original JSON
receipt was lost during the executor reset. Whole-repository Prettier and the final
worker/Web ESLint checks passed; the earlier formatter run at a 192 MiB heap
limit exhausted that artificial bound and remains unsuccessful.

Native Accounts `45937901453` (`29cbbe54`) finished with failure at 07:30 UTC in
step 8, the full Web TypeScript check, reporting the discriminator, runtime-reader
and timer diagnostics above. Browser installation, 40 screenshots, flows and role
visibility were all skipped: this run supplies no browser E2E evidence. The Web
preflight also depends on API types, so unchanged route/harness bytes do not
justify reusing a nonexistent browser pass. Corrected source requires its own
successful Native qualification.

Earlier full CI runs `45937669312`, `45940187687` and `45948041513` belong to
`29cbbe54`, `e6095e3e` and `f1ccb8cb` respectively; none qualifies `474b599b`.
The older Linux installer job `140316711863` reached Vitest and exceeded its
10-minute limit; its narrower cause remains unconfirmed. The original installer
file subsequently passed 63/63 with zero skips on clean `474b599b` under Node
26.11.1 in 49.578s, without changing source or leaving a child process. That local
result does not convert the cancelled CI job into a pass. Full CI `45963536826`
and Native `45963033128` bind to `474b599b` and require their own actual results.
The later artifact correction requires qualification on its final published head.

The stale conflict bundle was reproduced using the original parity assertion.
An isolated normal frozen installation of `474b599b` then completed the original
Action build (9.433s), smoke/parity gate (10.317s), and both whole CLI/workflow test
files (5/5, zero skips, 3.427s) under Node 26.11.1. The corrected artifact SHA256 is
`9123033425b72b4e9df8a6b5352c2e4dd7cc0e3d83c93ed2c8fd462226505dab`.
Independent review confirmed only minified unused declaration names changed;
the Codex bundle/archive/manifest and all source, pins and guards remained exact.
See the plan's canonical artifact correction for preparation failures and receipts.
This is smoke/CLI evidence, not the complete Source/Certification or binary gate.

The synthetic 20-repository fixture changed health/diagnostics child hydration
from 4,000 to 20 rows and policy from 2,000 to 20. The installation reader returns
40 latest statuses in one statement. The measured indexes remove repeated full
history work, including a forced generic prepared-plan test and a hot-repository
skew; these figures do not forecast production latency or supported user count.

Production verification should confirm independent worker progress during one
failed dependency, no duplicate admitted effect, stop/drain behavior, SQL pool
recovery after a controlled lock, latest-row query plans, catalog outage/restoration
and immutable existing admission. Verify webhook rollback/redelivery and lost
response recovery only with disposable event scope; never reset a real uncertain
receipt to manufacture a successful replay. Check Accounts final authorization
when session/source changes during optional enrichment. Use local disposable data
and secrets in tests, never real credentials in retained evidence.

## Retry, partial completion, and rollback

Inspect actual source and environment state before retrying. Do not repeat an
uncertain external effect, reset historical processing receipts or delete durable
outbox/audit rows. A lost commit acknowledgment is not proof of rollback: read the
receipt and use ordinary redelivery/idempotency instead of replaying effects.

Application rollback follows the existing release process. The additive indexes
can safely remain with old application code; dropping them is not necessary for
an application rollback and would remove the measured access paths. If index
removal is separately required, use the established reviewed migration procedure,
not edits to already applied history. Rollback removes new process resource bounds
but must preserve existing durable authority, replay fences and captured policy.

The event transaction isolation is deliberate: installation/auth/push preserve
ReadCommitted, and PR/repository workflow authority retains Serializable retries.
Retries exclude external preadmission and HTTP response delivery. Do not turn
all handler failures or ambiguous commits into generic automatic retry.

A failed webhook response is not an automatic retry schedule. [GitHub's delivery
controls](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks)
require explicit redelivery of failed events. A new transaction that rolled back
can be redelivered with its original identity; investigate historical uncertain
receipts before any replay. This batch adds no automatic delivery-recovery worker.

The close-capability correction inherited from main retries only a definite
401 `unauthenticated` / `not_dispatched` refusal after proving the original
operation and exact binding. It does not extend expired admission, replay
inference or establish why historical production bearers were rejected.

## Account lifecycle subscription follow-up

The account-models browser run on `69b7fb2d` completed all ten scenarios but
recorded six React warnings about updating PersonalControls during a child
query's render. The lifecycle activity hook subscribed directly to synchronous
QueryCache notifications. Its subscription now follows TanStack's own batched
notification pattern; cache writes, original operation identity, server authority,
uncertain-result readback and continuation rules retain their existing behavior.

The hook is extracted from the bounded lifecycle controls file, with direct
imports and a lower file-size ceiling. A focused regression exercises a real query
cache during child rendering and checks pending and terminal activity visibility.
These changes require the original full source and browser gates on the final
commit; the earlier browser pass does not certify this follow-up. Staging and
production rollout remain pending under the existing task.

The paired Action CI pin also adopts the actual owner-merged commit
`519026120e1769a9ff1f3ca8f26341f983969b5a`. Its tree equals independently qualified
`1ce5d0abc8300d024ec75c556df1ebbb41c3cbe7`; final consumer cold recovery and all four
private/public Node 24/26 joined runs remain required. A pin or merge is not
runtime activation.

## Captured v4 accepted-result recovery follow-up

The cold recovery case in [CI46107535668](https://github.com/777genius/review-router-ai/actions/runs/46107535668)
failed on consumer `90d7e1a489089a0edc6b140f4ee5661527bd03c5` with paired
Action `1ce5d0abc8300d024ec75c556df1ebbb41c3cbe7`
(`review_orchestration_restored_observation_unavailable`). Accepted observations
were durable, but the response omitted the persisted assignment v1 plan, so the
restarted Action rebuilt the invocation manifest instead of restoring the
original identity.

The response now includes the original persisted plan and accepted manifests
for assignment v1 only when the captured runtime parses as snapshot v4. Existing
lifecycle and assignment v2 paths are retained. Absent/null/v3 runtimes keep the
original eight-field response required by retained Hosted Pool
`66ac53a5953c2da498f7d2c3b644dd6ef5ccf3ff`. Authorization, original lease/fence,
attempt budgets, observation eligibility and protocol limits remain unchanged;
this adds no inference replay or new admission.

Four restore/start accepted/unattached cases and six legacy-response cases are
added. Independent source review passed. Local formatting, types and runtime
tests were not run because the executor was unavailable; the final source must
pass ordinary CI, including the unchanged real cold recovery and all four
private/public Node 24/26 joined executions. Staging and production remain pending.

## Related links

- [Implementation plan](../plans/2026-11-27-scale-and-recovery.md).
- [Draft PR #1021](https://github.com/777genius/review-router-ai/pull/1021).
- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).

## Execution log

| Time (UTC)   | Environment                 | Operator      | Source                                              | Step and observed result                                                                                                                                             | Next action                                                                 |
| ------------ | --------------------------- | ------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 2026-11-27   | Local qualification         | Coding agent  | `3cb28a1`, corrected test `c9659a4`                 | Initial HTTP suites passed 18 tests; response-close observation strengthened in review.                                                                              | Corrected suite subsequently passed on `e6095e3e`.                          |
| 2026-11-27   | Local qualification         | Coding agents | `b63ff68`                                           | Worker 227 and actual PostgreSQL/worker 9 passed.                                                                                                                    | Finish original strict projects.                                            |
| 2026-11-27   | Local qualification         | Coding agent  | `bdb4ac8`                                           | Accounts 155 passed, including real SDK/HTTP recovery.                                                                                                               | Final cross-owner review.                                                   |
| 2026-11-27   | Disposable PostgreSQL 17.10 | Coding agent  | F candidate on the same branch                      | 172 actual migrations; 16 latest-reader tests passed.                                                                                                                | Publish source and finish strict checks.                                    |
| 2026-11-27   | Local qualification         | Coding agent  | `e6095e3e`                                          | HTTP18 and six migration suites252 passed, zero skips; late ESLint/Prettier12 and shell syntax passed.                                                               | Complete strict/PG/full API/browser CI.                                     |
| 2026-11-27   | Local preparation           | Coding agents | `f1ccb8cb`, runtime `c7543bc7`                      | After earlier unavailable/killed attempts, verified isolated offline Prisma generation and complete pinned SDK build succeeded; no source or dependency pin changed. | Continue original strict projects.                                          |
| 2026-11-27   | Local qualification         | Coding agents | `f1ccb8cb` plus identified late source              | Full G, source-admission, installer, Usage and corrected webhook results recorded above; the initial invalid webhook fixture failure remains explicit.               | Publish the qualified source and complete full CI.                          |
| 2026-11-27   | GitHub CI                   | Coding agent  | `29cbbe54`                                          | Installer job140316711863 cancelled at the 10-minute limit; narrower cause unconfirmed. Local diagnostic was killed before Vitest collection.                        | Await current counterpart and remaining jobs; preserve timeouts/assertions. |
| 2026-11-27   | Local qualification         | Coding agents | Clean `474b599b`, architecture same-tree `1adc3da5` | Complete strict60, whole architecture and exact-Node26 installer63 passed; failed attempts remain separately recorded.                                               | Await final-source CI/Native and immutable-reader evidence.                 |
| 2026-11-27   | Canonical isolated build    | Coding agent  | `474b599b` plus the recorded artifact SHA256        | Action build/smoke and both complete CLI/workflow test files passed; independent generated-delta review found no critical issue.                                     | Publish the artifact correction and qualify that head.                      |
| Not executed | staging / production        | Unassigned    | Not verified                                        | No rollout of this Draft attempted. The separate peer installation record remains attributed to its owner.                                                           | Complete qualification before separately authorized release.                |
