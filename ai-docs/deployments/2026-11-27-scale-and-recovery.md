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
  Main was integrated into the Draft branch by
  `bff69a97f559b345bfc8e770235a2adbc1c3851b`. These references establish
  source only; no merge of this Draft into main, release or installation is claimed.
- Final main dependency: preserve the merged stale-close capability correction
  `ef062a4828ab96aa8199ca2710328c9644da96af` and its
  [separate deployment record](2026-11-27-relay-stale-close-capability.md).
  The combined API source and catalog-outage/401 interaction require qualification.
- Dependencies: preserve the already merged
  [multi-tenant reliability work](2026-11-25-multi-tenant-reliability.md);
  complete exact-head qualification before release selection.
- Last updated: `2026-11-27`.

## Environment status

| Environment / target | Status | Actual deployed version / image | Last verified (UTC) | Evidence / next step |
| --- | --- | --- | --- | --- |
| staging | `pending` | Not verified | Not verified | Complete qualification, then separately authorize release. |
| production | `pending` | Not verified | Not verified | No rollout attempted; use the release process and exact selected source. |

Pending means no verified completion is recorded, not an observation that an
installation is absent. Use the [status contract](README.md#status-contract).

## Applicability and prerequisites

The batch changes existing runtime boundaries. It adds no service, queue, feature
flag, provider protocol, customer configuration or credential migration.

| Area | Resulting behavior | Operational bound |
| --- | --- | --- |
| Worker phases | An unresponsive owner keeps its actual in-flight slot while independent owners continue. Stop prevents new claims and drains admitted work. | Observation timeout never authorizes repeating an uncertain effect. One-shot ordering is preserved. |
| GitHub reads/progress | Real App/token/body transport and whole-pass deadlines; complete inventory is required before reconciliation. | Failed inventory cannot imply repository deletion. Ambiguous mutations retain reconciliation semantics. |
| Runtime PostgreSQL | Explicit runtime clients use server statement and lock timeouts. | 30-second statements and 5-second lock waits; administrative and injected clients retain their existing policy. |
| Dashboard reads | Latest-per-parent SQL avoids historical child hydration and installation N+1. | Tenant filters and stable latest-row ordering remain explicit; no retention deletion. |
| Native catalog | One recoverable source serves new admission, settings and relay. | 30-second success TTL, one-second failure cooldown, existing ten-second SDK transport; captured admission identity/policy stays immutable. |
| Retained close capability from main | A definite no-effect 401 can refresh only the original capability and retry the same close identity. | Existing operation/binding proof and deadlines remain mandatory; expired or uncertain effects are not released by a timeout. |
| Webhook receipts | Receipt, local authority effects and outbox commit together. | Independent preadmission stays outside; historical uncertain processing receipts are preserved. |
| Accounts/HTTP | Optional enrichment shares a bounded window before final authorization; rejected body resources close. | Three-second optional remote window, four row enrichments per page; neither a total render SLA nor a process-wide cap. Provider-key envelope remains 256 KiB. |

Read the [implementation plan](../plans/2026-11-27-scale-and-recovery.md) for
acceptance contracts and the excluded open-PR ownership. Catalog/webhook and strict
qualification are still in progress; do not infer full approval from a checkpoint.

## Additive database migrations

| Migration | Definition and justification | Application compatibility |
| --- | --- | --- |
| `000165_installation_sync_latest_index` | Concurrent partial index on OutboxEvent aggregate ID, descending creation time and ID, limited to installation sync v1. Actual production SQL uses it under generic prepared plans. | Existing writers and old readers remain compatible. |
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

| Local evidence | Observed result | Exact limit of the evidence |
| --- | --- | --- |
| Worker ownership, shutdown, completion, GitHub HTTP | 227 focused tests passed after one duplicate-ID fixture correction. | Local transport/process fixtures, no customer GitHub mutations. |
| Runtime SQL plus worker/SQL integration | 9 actual PostgreSQL 17.10 tests passed. | Server cancellation, lock wait, disconnect and subsequent pool recovery; no throughput SLA. |
| Accounts enrichment and final fences | 155 tests in 11 suites passed; actual SDK/HTTP 100-account stalled body followed by successful recovery. | Final local authorization remains mandatory beyond the optional remote budget. |
| Latest-row readers and migrations | 16 tests passed; full 172 migrations applied, including both new indexes. | Driver SQL/rows, tenant and empty cases, ordering and real concurrent snapshot. Timings are synthetic. |
| Migration source admission on `29cbbe54` | Three legacy modules passed syntax checks; 14 checks of actual exported readers and partition functions passed. | Node 24.22.3 without dependency substitutions; not Vitest, strict TypeScript or PostgreSQL qualification. |
| Native catalog, atomic webhook, corrected catalog body assertion | Qualification in progress. | Source changes or an interrupted run are not passing evidence. |
| Strict projects and authoritative CI | In progress. | Queued/running/skipped or resource-killed checks are not successful completion. |

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

| Time (UTC) | Environment | Operator | Source | Step and observed result | Next action |
| --- | --- | --- | --- | --- | --- |
| 2026-11-27 | Local qualification | Coding agent | `3cb28a1`, corrected test `c9659a4` | Initial HTTP suites passed 18 tests; response-close observation strengthened in review. | Rerun strengthened assertion. |
| 2026-11-27 | Local qualification | Coding agents | `b63ff68` | Worker 227 and actual PostgreSQL/worker 9 passed. | Finish original strict projects. |
| 2026-11-27 | Local qualification | Coding agent | `bdb4ac8` | Accounts 155 passed, including real SDK/HTTP recovery. | Final cross-owner review. |
| 2026-11-27 | Disposable PostgreSQL 17.10 | Coding agent | F candidate on the same branch | 172 actual migrations; 16 latest-reader tests passed. | Publish source and finish strict checks. |
| Not executed | staging / production | Unassigned | Not verified | No rollout attempted. | Complete qualification before separately authorized release. |
