# Durable GitHub webhook delivery — completion plan

Status: production composition and bounded recovery are implemented in PR #1027.
The complete native PostgreSQL matrix has passed. Merge requires successful checks
on the exact reviewed final head; the PR validation and checks record that status.
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

Installation and repository retries are bounded by local receipt evidence. A newer
or equal-time lifecycle receipt for the same installation, or repository receipt
for the same canonical repository, blocks replay; an unknown legacy App identity
is treated conservatively. Repository retry also checks installation lifecycle
receipts and rejects missing canonical identity. The check runs during acquisition
and again under effect scopes/row locks, with advisory preflight before redelivery.
Admission of installation/repository receipts takes the same exclusive scope before
insertion, so a newer receipt cannot commit between the replay check and effect.
`receivedAt` is immutable on fenced receipts. This is local observation order, not
a claim about GitHub event chronology or arbitrary first-delivery ordering.

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
Keep the receipt for separately authorized reconciliation; do not synthesize a new
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

## Current execution evidence

Source `76f715cb57721558a6fff1dcf87696b7e2717c96` completed all 13 mandatory
PostgreSQL suites: **142 tests passed, zero failures, skips or todo**. Its tree
`4d75176b436fed41e180bc052c5da4425a09e2f8` exactly matches the executed source.
The runner applied the actual 170-migration baseline, seeded a legacy receipt and
expanded to all 172 migrations. It exercised signed HTTP/default composition,
Prisma/outbox, admission and ownership races, rollback, real COMMIT-response loss,
legacy-role compatibility and bounded one-shot recovery.

The fresh run found and corrected a UTC/session-timezone mismatch in authorization
expiry checks. Production composition now runs in an explicit Asia/Tokyo test
session; isolated authorization checks use Pacific/Honolulu and preserve expired
grants. Revocation timestamps must remain UTC. The expiry race observes a real
PostgreSQL lock wait and the specific reconciliation error, so a generic transaction
timeout cannot satisfy it.

The affected unit and qualification-harness run passed **111 tests in 15 files**,
with no skips. Changed-file formatting, the architecture check over 705
domain/application files and scoped webhook-tooling strict types passed. ESLint
passed for all 69 changed TypeScript files after removing two unused initial
assignments in the production fixture. These checks use the frozen root/API graph,
verified exact subscription-runtime artifact, isolated Prisma client generation,
Node 26.11.1, pnpm 11.28.7, TypeScript 7.0.2, Prisma 7.9.0 and Vitest 4.1.10.
The local database was PostgreSQL 17.10.

Earlier `3e017ec2` results (106 PostgreSQL tests and 78 focused units) are historical.
Local whole-API/feature compiler attempts interrupted by resource guards or
`SIGKILL` are not passing evidence. The final PR validation records subsequent
strict types, production build and compiled recovery CLI results; its exact-head
required checks remain the authority for merge readiness.

The existing CI runs `scripts/webhook-fencing/run-postgres.ts` on its own database
cluster, using a fresh process per suite and rejecting missing, skipped or failed
results. Queued or skipped jobs do not establish qualification. Independent review
confirmed that #1026's acknowledgement contract is covered by this default fenced
production path; its separate legacy repository changes are not imported. #1021's
worker and transport work remains outside this PR.

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
