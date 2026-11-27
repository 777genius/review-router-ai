# Scale and recovery: deployment

- Task ID: `2026-11-27-scale-and-recovery`.
- Goal: bounded resource use and recovery from component failures without
  restarting otherwise healthy services.
- Affected targets: API, Web, ordinary worker, skill worker and PostgreSQL indexes.
- Implementation: [Draft PR #1021](https://github.com/777genius/review-router-ai/pull/1021).
- Source checkpoints: worker/database `b63ff683148f2bbf7ecc7e2171883f5f6b4dd1bf`;
  Accounts `bdb4ac8ff76546781fc175526a2cba4e4ce108aa`;
  latest-row readers `d86e501a7c63e748596f4983d336d86868fe5f3f`;
  native catalog and webhook `dc9f0cd8cae93fff46044a4a8e2c4b2ac4b1c222`.
  The published integration checkpoint is
  `f1ccb8cb60f3ee9aaf11a49cbb793fcaf62de60f`; later local results below identify
  their additional fixture/acknowledgement source. These references establish
  source only; no merge of this Draft into main, release or installation is claimed.
- Final main dependency: preserve the merged stale-close capability correction
  `ef062a4828ab96aa8199ca2710328c9644da96af` and its
  [separate deployment record](2026-11-27-relay-stale-close-capability.md).
  Preserve the follow-up binding guard `6271ebe1f5e98bb376b4c7269394f806cb73041f`
  from main `d84feba7ae08cf477f5b0584e526971f38458c04`. The peer reports its own
  production installation; this Draft remains uninstalled. The combined relay189
  and snapshot91 locally passed on `f1ccb8cb`, including catalog-outage/401 recovery.
- Later overlap review: adapt only acknowledgement semantics from open
  [#1026](https://github.com/777genius/review-router-ai/pull/1026) at
  `78ed993e8603aa254ee5022b43564845aa11e540`, preserving our conflict-safe
  transaction. Draft #1027 now has head
  `ec6f66a1fe0063e8bca0263486cc76457c9324a2`; its five later commits overlap eight
  transaction-adapter/export paths, but the new composite prototypes remain
  unrouted and incomplete. Its fencing/takeover and separate migration165 stay
  excluded. Main `fa690ad6ffc7769cbaa0ee80a5e18414eef1249d` adds only three
  operations/deployment documents and a PostgreSQL needrestart override after
  `d84feba7`; no application/migration/CI integration is needed for those changes.
- Dependencies: preserve the already merged
  [multi-tenant reliability work](2026-11-25-multi-tenant-reliability.md);
  complete exact-head qualification before release selection.
- Last updated: `2026-11-27`.

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
acceptance contracts and the excluded open-PR ownership. Local failure/recovery
qualification is recorded below; complete original strict projects and full CI
remain unfinished. Do not infer release approval from a local checkpoint.

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

| Local evidence                                      | Observed result                                                                                                                                                                                                                      | Exact limit of the evidence                                                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker ownership, shutdown, completion, GitHub HTTP | 227 focused tests passed after one duplicate-ID fixture correction.                                                                                                                                                                  | Local transport/process fixtures, no customer GitHub mutations.                                                                                                                                                         |
| Runtime SQL plus worker/SQL integration             | 9 actual PostgreSQL 17.10 tests passed.                                                                                                                                                                                              | Server cancellation, lock wait, disconnect and subsequent pool recovery; no throughput SLA.                                                                                                                             |
| Accounts enrichment and final fences                | After the timer correction, all 11 complete files passed again: 155/155, zero skips, in 9.511s; actual SDK/HTTP 100-account stall/recovery remains covered.                                                                          | Fresh source-bound receipt preserves identical before/after hashes. Final local authorization remains mandatory beyond the optional remote budget.                                                                      |
| Latest-row readers and migrations                   | 16 tests passed; full 172 migrations applied, including both new indexes.                                                                                                                                                            | Driver SQL/rows, tenant and empty cases, ordering and real concurrent snapshot. Timings are synthetic.                                                                                                                  |
| Migration source admission                          | 382/382 cumulatively across seven complete files, zero skips: 252 on `e6095e3e` plus unchanged private-rehearsal unit file130 on `f1ccb8cb`.                                                                                         | Source/catalog validation, not a live PG upgrade or private Docker rehearsal. Full release gates remain separate; original assertions/configs retained.                                                                 |
| HTTP catalog body and provider-key envelope         | On `e6095e3e`, all 18 tests passed without skips, including the corrected unfinished-response close assertion.                                                                                                                       | Real loopback transport recovery and the existing 256 KiB request limit.                                                                                                                                                |
| Native catalog                                      | On `f1ccb8cb`, both complete files passed: relay189 plus snapshot91, 280/280 with zero skips.                                                                                                                                        | Includes the main binding guard and catalog-outage/401 close interaction; no paid-model or production inference qualification is claimed.                                                                               |
| Atomic webhook and exact acknowledgement            | On the late source, 122/122 unit/HTTP/adapter cases in ten files passed, including repository13; PostgreSQL 17.10 passed atomicity27 plus COMMIT-loss1, 28/28 with zero skips.                                                       | Full 172-migration schema; historical uncertainty and mismatched identity are rejected, exact processed duplicates acknowledge without repeated effects. No recovery lease or production redelivery.                    |
| Usage fixture correction                            | On unchanged `f1ccb8cb` Usage/DB source, all 20 tests passed on PostgreSQL 17.10, zero skips; opt-in SQL qualification passed six bounded-plan scenarios.                                                                            | The six scenarios are included in those 20 tests. Exact four-line #1015 correction and full report equality retained; CI PG17.5 remains separate.                                                                       |
| Installer fixture cleanup                           | On `f1ccb8cb` plus the cleanup patch, the original full file passed 63/63, zero skips, in 46.724s. Forced shlock exit17 separately failed the original assertion as expected, with the child already dead before supervisor cleanup. | Node 24.22.3/Vitest 4.1.10, original forks configuration and deadlines. The diagnostic deliberately selected only one case; no remaining child in either run. This is not a diagnosis or pass for the older CI timeout. |
| Late source checks                                  | On `e6095e3e`, 12 late JS/TS files passed ESLint/Prettier and shell syntax passed. The five later acknowledgement/fixture files also passed canonical formatting and ESLint.                                                         | Zero lint warnings/errors; complete original strict projects and CI remain separate.                                                                                                                                    |
| Late strict corrections and affected regressions    | Original GitHub-installations, review-config and worker strict projects passed; the corrected snapshot file passed 91/91 again and all three shutdown cases passed.                                                                  | Repeated affected cases are not additional totals. Full Web strict was interrupted by SIGKILL; complete Web strict and the final fresh 60-configuration graph remain pending.                                           |
| Native browser and authoritative CI                 | Native run45937901453 failed at full Web TypeScript preflight; every browser/screenshot/flow/visibility step was skipped. Three full CI runs remain pending.                                                                         | No browser E2E result exists from that run. Queued/running/skipped or resource-killed checks are not successful completion.                                                                                             |

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
source hashes in `qualification-j-account-enrichment-f1.json`. The first full Web
strict attempt was interrupted by SIGKILL without a TypeScript diagnostic;
complete Web strict and the fresh full graph remain pending.

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
those exact bindings, the unchanged metadata typecheck passed. A clean complete
architecture invocation remains pending. Whole-repository Prettier and the final
worker/Web ESLint checks passed; the earlier formatter run at a 192 MiB heap
limit exhausted that artificial bound and remains unsuccessful.

Native Accounts `45937901453` (`29cbbe54`) finished with failure at 07:30 UTC in
step 8, the full Web TypeScript check, reporting the discriminator, runtime-reader
and timer diagnostics above. Browser installation, 40 screenshots, flows and role
visibility were all skipped: this run supplies no browser E2E evidence. The Web
preflight also depends on API types, so unchanged route/harness bytes do not
justify reusing a nonexistent browser pass. Corrected source requires its own
successful Native qualification.

Full CI runs `45937669312` (`29cbbe54`), `45940187687` (`e6095e3e`) and
`45948041513` (`f1ccb8cb`) still lack final completion evidence. The earlier Linux
installer job `140316711863` reached Vitest and exceeded its 10-minute job limit;
its narrower cause remains unconfirmed. Neither the local precollection SIGKILL
nor the later 63-case pass resolves that historical CI outcome. CI Node 26.11.1
and the final corrected published source remain separate qualification boundaries.

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

## Related links

- [Implementation plan](../plans/2026-11-27-scale-and-recovery.md).
- [Draft PR #1021](https://github.com/777genius/review-router-ai/pull/1021).
- [Release process](../operations/07-environments-and-release-management.md).
- [Quality gates](../operations/03-quality-gates.md).

## Execution log

| Time (UTC)   | Environment                 | Operator      | Source                                 | Step and observed result                                                                                                                                             | Next action                                                                 |
| ------------ | --------------------------- | ------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 2026-11-27   | Local qualification         | Coding agent  | `3cb28a1`, corrected test `c9659a4`    | Initial HTTP suites passed 18 tests; response-close observation strengthened in review.                                                                              | Corrected suite subsequently passed on `e6095e3e`.                          |
| 2026-11-27   | Local qualification         | Coding agents | `b63ff68`                              | Worker 227 and actual PostgreSQL/worker 9 passed.                                                                                                                    | Finish original strict projects.                                            |
| 2026-11-27   | Local qualification         | Coding agent  | `bdb4ac8`                              | Accounts 155 passed, including real SDK/HTTP recovery.                                                                                                               | Final cross-owner review.                                                   |
| 2026-11-27   | Disposable PostgreSQL 17.10 | Coding agent  | F candidate on the same branch         | 172 actual migrations; 16 latest-reader tests passed.                                                                                                                | Publish source and finish strict checks.                                    |
| 2026-11-27   | Local qualification         | Coding agent  | `e6095e3e`                             | HTTP18 and six migration suites252 passed, zero skips; late ESLint/Prettier12 and shell syntax passed.                                                               | Complete strict/PG/full API/browser CI.                                     |
| 2026-11-27   | Local preparation           | Coding agents | `f1ccb8cb`, runtime `c7543bc7`         | After earlier unavailable/killed attempts, verified isolated offline Prisma generation and complete pinned SDK build succeeded; no source or dependency pin changed. | Continue original strict projects.                                          |
| 2026-11-27   | Local qualification         | Coding agents | `f1ccb8cb` plus identified late source | Full G, source-admission, installer, Usage and corrected webhook results recorded above; the initial invalid webhook fixture failure remains explicit.               | Publish the qualified source and complete full CI.                          |
| 2026-11-27   | GitHub CI                   | Coding agent  | `29cbbe54`                             | Installer job140316711863 cancelled at the 10-minute limit; narrower cause unconfirmed. Local diagnostic was killed before Vitest collection.                        | Await current counterpart and remaining jobs; preserve timeouts/assertions. |
| Not executed | staging / production        | Unassigned    | Not verified                           | No rollout of this Draft attempted. The separate peer installation record remains attributed to its owner.                                                           | Complete qualification before separately authorized release.                |
