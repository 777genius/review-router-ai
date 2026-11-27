# Durable GitHub webhook delivery — completion plan

Status: implementation and qualification in progress in PR #1027. No production
migration, replay, deployment or activation has been performed by this workstream.

## Outcome and scope

A verified supported GitHub event has one durable delivery identity. Local effects,
its existing outbox commands and its terminal receipt commit together. A stopped
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

| Event / owner                                                      | Local effects and existing command owner                                             | Scope / row order                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `installation`, `installation_repositories` — GitHub installations | Installation/workspace membership and repository authority; installation-sync outbox | Existing global exclusive scope → delivery → fence → installation and dependent rows             |
| `repository` — repository webhook adapter                          | Repository selection/metadata, SCM identity invalidation, workflow state             | Existing global exclusive scope → delivery → fence → repository rows                             |
| `pull_request` — ingress/setup/conflict composite                  | Review intent outbox, setup workflow CAS, optional conflict outbox                   | Global shared scope → delivery → fence → installation then repository shared rows → workflow CAS |
| `push` — conflict handler                                          | Optional existing conflict outbox                                                    | Delivery → fence → outbox; no global exclusive lock                                              |
| `github_app_authorization` — authorization adapter                 | GitHub authorization revocation and its permission cache                             | Delivery → fence → authorization/cache rows                                                      |

`PrismaGitHubInstallationRepository` and `PrismaInstallationWorkspaceOwnerGrant`
expose transaction-bound operations reused by the installation adapter. Existing
workflow and outbox owners retain their idempotency keys. The production composition
selects fenced processing for every supported event; no new feature flag selects it.
The legacy dependency-injection route remains for existing isolated adapters/tests,
and is never selected by the default production composition.

No handler invokes provider/GitHub HTTP inside its retryable database effect.
Installation synchronization and review/conflict work remain commands for existing
outbox workers, whose authority/idempotency contracts are unchanged. Source census
includes all delivery repository calls and raw SQL/maintenance references. No generic
repository-wide authority scanner or new architectural framework is required.

## Delivery invariants

- App identity comes from trusted App ID/API origin paired with the webhook secret.
  Raw-body HMAC verification precedes parsing and all writes. The full receipt binds
  App, GUID, event, action, installation and exact authenticated body hash.
- New delivery and fence creation are atomic. Never add a fence to a legacy row.
  A matching processed receipt is the only successful duplicate acknowledgement;
  legacy processing/failed/unknown and identity mismatches remain fail closed.
- Claims have random owner hashes, monotonic generations and database-clock leases.
  An expired processing or failed fenced claim can be replaced under the same row
  locks; an active owner, processed receipt or mismatch cannot be replaced.
- Every effect first acquires its complete scope plan, then delivery/fence rows.
  READ COMMITTED rereads after waits. The fence is checked before and after local
  work; effect, outbox and processed status share one transaction/connection.
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
A small operational command provides read-only status/eligibility and an explicit
one-shot recovery request, followed by bounded read-only reconciliation. It adds no
HTTP administration endpoint or scheduler subsystem.

Recovery accepts only already-ingressed fenced deliveries. Trusted GitHub delivery
metadata and the retained verified signature digest must match the local exact body
identity. Missing/redacted signatures, secret-rotation ambiguity, unknown originals
and never-ingressed deliveries fail closed. HMAC authenticates the body, not event
headers or network provenance. A captured identical signed body arriving first must
still produce at most the same already-authorized local effect.

The durable intent is reserved before POST. A lost reservation/POST response remains
unknown and never authorizes a second POST. HTTP 202 means accepted, not processed.
Repeated commands inspect the existing custody state and reconcile; only an exact
processed receiver receipt confirms recovery. Pagination is bounded and incomplete,
rate-limited, cancelled and retention-expired observations stay visible as such.

## Qualification plan

1. [x] Inspect handoff and obtain two independent design/code critiques.
2. [x] Remove unrelated account/auth/config epochs and retain current owner contracts.
3. [ ] Wire all six event families through production signed HTTP composition.
4. [ ] Complete claim, retry, stale terminal rejection, failure and recovery transitions.
5. [ ] Apply the complete actual migration history to a disposable PostgreSQL database;
       exercise trigger/check/index behavior and application-role privileges (no db push).
6. [ ] Run real signed HTTP → Prisma → PostgreSQL → outbox E2E, including concurrent
       duplicate, body/App mismatch, death before effects, rollback during effects,
       expired held owner, simultaneous takeover, stale finish/fail/renew and COMMIT loss.
7. [ ] Verify independent PR/push work, setup versus authority change, old terminal
       writer rejection, legacy no-takeover and old schema reader compatibility.
8. [ ] Exercise one POST, response loss, duplicate request, fake 202/200 without a
       receipt, exact receiver confirmation and bounded pagination/rate-limit failures.
9. [ ] Run affected tests, strict TypeScript 7.0.2, lint/format/architecture and required
       full CI. Mandatory PostgreSQL qualification must fail if its tests are skipped.
10. [ ] Review the complete final diff independently; fix findings and repeat affected
        evidence. Reconcile PR #1026's acknowledgement contract and overlapping #1021 work.

## Rollout and rollback

The deployment registry owns operational evidence. Expand schema first; verify role
grants and checks. Quiesce ingress, stop/drain all old API/webhook writers and their
transactions, then start the exact qualified API version and reopen ingress. Do not
infer old-writer drain from elapsed time, schema presence or green unit tests.

Legacy unknown deliveries remain retained. The receipt trigger remains installed
on application rollback. Stop new admission and drain all fenced work before any
legacy binary returns; a legacy binary cannot safely process new-generation work.
No production rollback drops custody, fence rows or terminal receipts. Real external
replay and rollout require their separately authorized operational task.
