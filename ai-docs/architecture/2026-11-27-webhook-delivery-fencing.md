# Durable GitHub webhook delivery — completion plan

Status: production composition and bounded recovery are implemented in PR #1027.
Recorded native checkpoints passed the complete PostgreSQL matrix. Later changes
require their own qualification; merge requires successful checks on the exact
reviewed final head. The PR validation and checks record that status.
No production migration, replay, deployment or activation has been performed.

## Outcome and scope

A verified supported GitHub event has one durable delivery identity. Local effects,
existing outbox commands and the terminal receipt commit together, with the explicit
PR ingress boundary described below. A stopped
handler can be replaced only when the complete local effect protocol proves that
its older generation cannot commit. HTTP success never acknowledges unfinished or
mismatched work. Operator recovery issues at most one GitHub redelivery request and
reports success only after the exact receiver receipt is processed.

This continuation supersedes the experimental epoch design at
`783409f2a21edc182df216d63c1f3cb4b84785bf`. Its historical tests and known negative
reproductions remain available in Git history; they are not qualification of the
revised implementation.

In scope: the six existing webhook event families, authenticated ingress, delivery
claims, local effect/outbox transactions, bounded known-delivery reconciliation,
actual PostgreSQL migrations/privileges, old-writer rejection, race and HTTP E2E.

Out of scope: provider-account lifecycle redesign, workspace/auth membership epoch
migration, general admission/entitlement changes, new services/queues/dependencies,
production replay/deployment, never-ingressed automatic recovery and guarantees
about an external operation already in flight. PR #1021 owns its separate worker,
transport, catalog and dashboard improvements; it is not imported or qualified here.

## Design review and selected approach

Two independent reviewers inspected the handoff, concrete handler reads/writes and
failure protocol. The first review found an unnecessary global exclusive lock on
ordinary PR/push events, missing failed-to-retry transitions, unconnected routes and
unsafe old terminal writers. The second review verified that these handlers do not
read the account/entitlement authority that the draft was converting to epochs.

| Approach                                                                                       | Incremental production/integration LOC | Tests/fixtures LOC | Engineer-days | Fitness / reliability / complexity |
| ---------------------------------------------------------------------------------------------- | -------------------------------------: | -----------------: | ------------: | ---------------------------------- |
| Complete repository-wide SERIALIZABLE epochs                                                   |                            2,500–5,000 |        3,000–6,000 |          8–16 | 4 / 7 / 9                          |
| READ COMMITTED, existing scope locks, exact delivery fence and atomic local effects (selected) |                              700–1,500 |        1,000–2,000 |           3–6 | 9 / 8 / 5                          |
| Atomic receipt/effects only, without durable takeover or recovery custody                      |                                300–700 |          500–1,000 |           1–3 | 5 / 8 / 3                          |

These are engineering estimates, not delivery promises or measured availability.
Reliability is within each option's stated scope. Generated files, existing draft
code, documentation and production rollout are excluded. The smaller atomic-only
option does not finish this PR's abandoned-delivery recovery goal. The selected
approach removes the broad epoch changes rather than claiming their incomplete
writer census is safe. It preserves existing authority ownership and checks.

Round-two criticism requires complete lock ordering, an installation/repository
reread after row-lock waits for setup completion, no external callback retries,
exact App/body binding, and real migrated PostgreSQL tests. A receipt trigger alone
cannot qualify an old fleet's earlier unguarded effects; deployment still requires
a controlled writer drain. These findings are implementation requirements below.

## Exact local-effect inventory

| Event / owner                                                      | Local effects and existing command owner                                                      | Scope / row order                                                                                                                                                |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `installation`, `installation_repositories` — GitHub installations | Installation/workspace membership and repository authority; installation-sync outbox          | Existing global exclusive scope → delivery → fence → installation and dependent rows                                                                             |
| `repository` — repository webhook adapter                          | Repository selection/metadata, SCM identity invalidation, workflow state                      | Existing global exclusive scope → delivery → fence → repository rows                                                                                             |
| `pull_request` — ingress/setup/conflict composite                  | First-generation ingress outbox; then setup CAS, optional conflict outbox and terminal status | Both phases: global shared → delivery → fence. Ingress policy: installation → workspace shared rows. Setup: installation → repository shared rows → workflow CAS |
| `push` — conflict handler                                          | Optional existing conflict outbox                                                             | Delivery → fence → outbox; no global exclusive lock                                                                                                              |
| `github_app_authorization` — authorization adapter                 | GitHub authorization revocation and its permission cache                                      | Delivery → fence → authorization/cache rows                                                                                                                      |

`PrismaGitHubInstallationRepository` and `PrismaInstallationWorkspaceOwnerGrant`
expose transaction-bound operations reused by the installation adapter. Existing
workflow and outbox owners retain their idempotency keys. The production composition
selects fenced processing for every supported event; no new feature flag selects it.
The legacy dependency-injection route remains for existing isolated adapters/tests,
and is never selected by the default production composition.

For enabled PR ingress, the first generation atomically persists the receipt,
fence and review-ingress outbox. Generic PR effects and terminal status commit in a
second fenced transaction. An ingress failure rolls back the initial claim; a later
generic failure retains its already-durable ingress. Later generations never recreate
initial ingress, including after an existing rollout-flag change or outbox retention.

No handler invokes provider/GitHub HTTP inside its database transaction.
Installation synchronization and review/conflict work remain commands for existing
outbox workers, whose authority/idempotency contracts are unchanged. Source census
includes all delivery repository calls and raw SQL/maintenance references. No generic
repository-wide authority scanner or new architectural framework is required.

## Delivery invariants

- App identity comes from trusted App ID/API origin paired with the webhook secret.
  Raw-body HMAC verification precedes parsing and all writes. Lifecycle actions are
  checked against their event family before admission. The full receipt binds App,
  GUID, event, action, installation and exact authenticated body hash.
- New delivery and fence creation are atomic. Never add a fence to a legacy row.
  A matching fenced processed receipt is the only successful duplicate acknowledgement;
  legacy processing/failed/unknown and identity mismatches remain fail closed.
- Claims have random owner hashes, monotonic generations and database-clock leases.
  An expired processing or failed fenced claim can be replaced under the same row
  locks and only if replay remains eligible; an active owner, processed receipt or
  mismatch cannot be replaced.
- Every effect first acquires its complete scope plan, then delivery/fence rows.
  READ COMMITTED rereads after waits. The fence is checked before and after local
  work; each effect phase shares one transaction/connection. The initial PR ingress
  boundary above is intentionally durable before the generic phase.
- The migration's receipt trigger rejects legacy terminal changes or deletion of a
  fenced delivery unless the validated fence names the current database transaction.
  This is a local compatibility defense, not proof of a safe mixed production fleet.
- Failure recording occurs only after rollback, checks the exact generation and
  cannot overwrite a committed receipt or replacement owner. Unknown commit outcomes
  are reconciled; they do not authorize another external mutation.
- Transactions and leases are bounded. No handler callback containing external I/O
  is retried automatically. Independent push/PR work remains concurrent.

## Recovery boundary

The existing operator environment supplies App JWT credentials and a database URL.
The `pnpm webhook:recover` operational command provides `inspect`, `request` and
`reconcile` for one GUID and numeric GitHub delivery ID. `inspect` is read-only;
`request` may reserve one POST; `reconcile` never sends a POST but can write the local
custody confirmation after receiver readback. It adds no
HTTP administration endpoint or scheduler subsystem. Ingress requires a trusted
`GITHUB_APP_ID`, webhook secret, API origin and matching App slug. The recovery
client currently supports `https://api.github.com` only; App identity must match.

Recovery accepts only already-ingressed fenced deliveries. Trusted GitHub delivery
metadata and the retained verified signature digest must match the local exact body
identity. Missing/redacted signatures, secret-rotation ambiguity, unknown originals
and never-ingressed deliveries fail closed. An authorization preflight failure,
including an unavailable GitHub detail response, reports `not_authorized`. HMAC
authenticates the body, not event headers, delivery age, GUID or network provenance.
Action-family validation prevents a lifecycle body from changing meaning through a
relabeled event header; it does not establish global provider chronology.

The durable intent is reserved before POST. A lost reservation/POST response remains
unknown and never authorizes a second POST. HTTP 202 means accepted, not processed.
Repeated commands inspect the existing custody state and reconcile; only an exact
processed receiver receipt confirms recovery. Pagination is bounded and incomplete,
rate-limited and cancelled poll observations stay visible; an unavailable original
can only be reported as not authorized, without inferring its retention cause.
`processed` with `githubDeliveryIdBound: false` describes the local receipt only;
the supplied numeric ID has not been bound in custody. `confirmed` requires exact
custody and receiver identity. Unknown or accepted custody is shown by `inspect` as
`reconciliation_required`, never a fresh permission to POST.

After GitHub authorization returns, `inspect` reads receiver/custody, lease and
replay eligibility in one short local REPEATABLE READ snapshot. HTTP stays outside
that transaction. This is an observation at that snapshot; a subsequent `request`
still reauthorizes and reserves through the existing guarded protocol.

Installation and repository retries are bounded by local receipt evidence. A newer
or equal-time lifecycle receipt for the same installation, or repository receipt
for the same canonical repository, blocks replay; an unknown legacy App identity
is treated conservatively. Repository retry also checks installation lifecycle
receipts and rejects missing canonical identity. The check runs during acquisition
and again under effect scopes/row locks, with advisory preflight before redelivery.
Admission of installation/repository receipts takes the same exclusive scope before
insertion, so a newer receipt cannot commit between the replay check and effect.
Initial lifecycle/repository receipts sample the existing database clock after
acquiring the admission guard. Their `receivedAt` is at least one millisecond after
the maximum already retained receipt in the conflicting installation/repository
scope, for the same proven App or an unfenced legacy receipt. Lifecycle admission
includes earlier repository work; canonical repository identity preserves the floor
across installation transfers. Unrelated proven Apps do not contribute.

The floor uses separate descending installation and canonical-repository lookups,
with App/legacy eligibility applied before each `LIMIT 1`. `GREATEST` combines the
two eligible observations. Additive migration `000168_webhook_receipt_order_indexes`
provides a partial ordered index for each lookup. This avoids scanning unrelated
retained history under the admission guard; it does not impose a constant-time
bound when many newer rows in the same scope belong to other Apps.

This keeps admission ordered after clock rollback and after retained legacy writes
whose database default used a different session timezone. Legacy timestamps are
neither rewritten nor converted using a guessed original timezone. The ordered
observation key may temporarily be ahead of wall time; lease deadlines continue to
use the current database clock. `receivedAt` remains immutable on fenced receipts.
This is retained local observation order, not GitHub chronology. It does not make
later unguarded legacy writers safe: the controlled writer drain remains mandatory.

An authorization-revocation body has no original grant revision, and a new GUID
does not make it fresh. Before any destructive change, the adapter reads one current
token/revision/expiry snapshot and performs a bounded read-only GitHub `/user`
request outside the transaction. A valid response for the expected user preserves
the grant. A `401` can revoke only that exact unrefreshed snapshot under the auth
owner's row lock, using a fresh database clock and the existing five-minute expiry
skew. Database comparisons and timestamp writes use UTC explicitly, matching
Prisma's timestamp-without-timezone storage even in a non-UTC PostgreSQL session. Reconnect, refresh, near/unknown expiry, other HTTP outcomes and unavailable
evidence require reconciliation without changing the grant or its permission cache.
This prevents an unsupported destructive revocation; existing authorization/cache
policy still governs subsequent requests and is not claimed to be globally denied.

Automatic authorization generation replacement and redelivery remain unsupported.
Keep the receipt for the separately authorized
[exact-grant reconciliation procedure](../deployments/2026-11-27-webhook-effect-fence.md#exact-grant-authorization-reconciliation);
do not synthesize a new
GUID, reset custody, or rewrite history to force replay. Old receivers do not acquire
this token check from the schema migration: the controlled fleet drain is mandatory.

## Qualification plan

1. [x] Inspect handoff and obtain two independent design/code critiques.
2. [x] Remove unrelated account/auth/config epochs and retain current owner contracts.
3. [x] Wire all six event families through production signed HTTP composition
       (source complete; runtime qualification remains below).
4. [x] Implement bounded claim/retry, stale terminal rejection, failure and known
       recovery transitions (source complete; execution proof remains below).
5. [x] Apply the complete actual migration history to a disposable PostgreSQL database;
       exercise trigger/check/index behavior and application-role privileges (no db push).
6. [x] Run real signed HTTP → Prisma → PostgreSQL → outbox E2E, including concurrent
       duplicate, body/App mismatch, death before effects, rollback during effects,
       expired held owner, simultaneous takeover, stale finish/fail/renew and COMMIT loss.
7. [x] Verify independent PR/push work, setup versus authority change, old terminal
       writer rejection, legacy no-takeover and old schema reader compatibility.
8. [x] Exercise one POST, response loss, duplicate request, fake 202/200 without a
       receipt, exact receiver confirmation and bounded pagination/rate-limit failures.
9. Run affected tests, strict TypeScript 7.0.2, lint/format/architecture and required
   full CI. Mandatory PostgreSQL qualification must fail if its tests are skipped.
10. Review the complete final diff independently; fix findings and repeat affected
    evidence. Reconcile PR #1026's acknowledgement contract and overlapping #1021 work.

## Recorded execution evidence

Source `7bb2a59d4611e57acb847a1190bfdf7bf128637b`, tree
`27933d3b0b4eb0c1b2a0d668e68f303741064e45`, completed all 13 mandatory PostgreSQL
suites: **160 tests passed, zero failures, skips or todo**, in 71.265 seconds.
The source guard, product runner exit and all 13 JSON reports were independently
checked. That checkpoint applied the actual 170-migration baseline, preserved a
legacy receipt and expanded to 172 migrations. It covered signed HTTP/default
composition, Prisma/outbox, admission and takeover races, rollback, real
COMMIT-response loss, legacy-role compatibility and bounded one-shot recovery.

Its 42 core fence cases include clock rollback, transfer scope and retained legacy
SQL-default timestamps in Tokyo and Honolulu. The production/recovery suites
include 41 and 22 cases respectively. They verify current receiver/custody state
after HTTP, a coherent local inspection snapshot, the exact injected terminal
constraint, the actual database lock wait and the confirmation statement deadline.
UTC expiry/revocation semantics remain verified under non-UTC sessions.

The affected unit and qualification-harness run passed **127 tests in 15 files**,
without skips, on tree `10b0e51308e81603b0c32eb2b3c4b7093b035ee0`. The only change
from that tree to `27933d3b` corrected the PostgreSQL-only timezone seed; the unit
inputs were unchanged. Installations and scoped tooling strict types passed before
that final seed correction. The 11-file follow-up and its later fixture fixes
passed native format/lint. The standalone architecture check passed over 705
domain/application files on `27933d3b`, as did ordinary shared, database, config,
outbox and installations builds. API compiler/build attempts stopped by resource
guards are not passes; the current-source compiled CLI still requires its gate.

The exact documented grant-reconciliation SQL also passed on a separate fresh
PostgreSQL 17.10 cluster after all 172 migrations. Temporary-table fixtures verified
stale revision and active-refresh denial, exact CAS/cache isolation, UTC writes and
rejection of a repeated old revision. SQL SHA-256:
`bc4290d78e8e93e5e0a48630a3fc5d3ed95909230475d4fed86bc5f36fa210b5`.
This was a disposable proof, not an operational grant decision or production write.

Subsequent catalog, Link-parser and indexed-query corrections have their own
qualification. The current source adds migration `000168`, so the required runner
now rehearses **170 → 173 migrations**. The existing migration suite includes a
plan regression on retained synthetic history: it observes the actual production
claim SQL and binds those parameters to PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)`.
It verifies scoped results and indexed work without forcing a planner setting or
asserting elapsed milliseconds. The current PR validation and exact-head CI record
the execution results; the earlier 160-test checkpoint does not certify these
later changes.

The previous `91621693` checkpoint passed 142 PostgreSQL tests, strict feature and
scoped tooling types, dependency/API builds and the compiled recovery CLI in a
clean production environment with isolated network. The `a505ab23` checkpoint
passed 118 unit/harness tests but its PostgreSQL attempt was interrupted. Earlier
`3e017ec2` results are historical. These checks use the frozen root/API graph,
verified pinned subscription-runtime artifact, isolated Prisma generation,
Node 26.11.1, pnpm 11.28.7, TypeScript 7.0.2, Prisma 7.9.0 and Vitest 4.1.10.

The existing CI runs `scripts/webhook-fencing/run-postgres.ts` on its own database,
with a fresh process per suite and rejection of missing, skipped or failed results.
Whole-API strict types, ordinary API build and actual compiled recovery CLI checks
remain required on the final source. Queued, skipped or resource-interrupted jobs
do not establish qualification. Independent review confirmed that #1026's
acknowledgement contract is covered by this default fenced path. #1021's broader
worker/transport work remains outside this PR; existing catalog tooling is updated
only to admit the exact checked-in migrations and preserve its frozen inventories.

## Rollout and rollback

The [deployment registry](../deployments/2026-11-27-webhook-effect-fence.md) owns
operational evidence. Quiesce ingress and stop/drain all old API/webhook and
maintenance writers and their transactions. Expand the schema through the approved
release path and verify role grants/checks before starting the exact qualified API
version and reopening ingress. Every receipt-writing role, including legacy,
maintenance and rollback roles, needs `SELECT` on `GitHubWebhookFence` before it
resumes: the invoker-rights receipt trigger reads that table even for unfenced rows.
Retain that grant through application rollback. It does not permit fence writes or
legacy terminal overwrites. Do not infer old-writer drain from elapsed time, schema
presence or green unit tests.

Legacy unknown deliveries remain retained. The receipt trigger remains installed
on application rollback. Stop new admission and drain all fenced work before any
legacy binary returns; a legacy binary cannot safely process new-generation work.
No production rollback drops custody, fence rows or terminal receipts. Real external
replay and rollout require their separately authorized operational task.
