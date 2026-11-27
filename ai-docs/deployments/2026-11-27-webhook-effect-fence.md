# Durable GitHub webhook delivery: deployment

- Task ID: `2026-11-27-webhook-effect-fence`.
- Goal: supported signed webhooks retain durable ownership, commit their local
  effects safely, and permit bounded recovery without duplicate redelivery requests.
- Affected targets: API and database; existing outbox workers retain ownership of
  external commands. Their compatibility must be checked during the fleet drain.
- Implementation: [PR #1027](https://github.com/777genius/review-router-ai/pull/1027).
- Qualified native checkpoint: `7bb2a59d4611e57acb847a1190bfdf7bf128637b`
  passed all 13 PostgreSQL suites with 160 tests and zero skips. Later catalog,
  parser and indexed-query changes require their own qualification. Select the exact reviewed final source
  only after its required PR checks, strict types, production build and compiled CLI
  checks pass; a local checkpoint alone is not release authorization.
- Dependencies: existing release/migration authority and configuration; no new
  service, queue, dependency or activation flag.
- Last updated: `2026-11-27`.

## Environment status

| Environment / target | Status    | Actual deployed version / image | Last verified (UTC) | Evidence / next step / blocker                                                              |
| -------------------- | --------- | ------------------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| staging              | `pending` | Not verified                    | Not verified        | Final-source checks, migration/grant review and controlled fleet cutover remain.            |
| production           | `pending` | Not verified                    | Not verified        | No production migration, replay, deployment or activation was performed by this workstream. |

`pending` means no verified completion is recorded; it is not evidence that code
is absent. A merge or passing CI does not change deployment status.

## Implementation and qualification

All six supported event families use the default fenced production processor.
Initial enabled PR ingress commits with generation-one receipt/fence acquisition;
generic PR effects and terminal status follow in a separate guarded transaction.
Later generations never recreate that ingress. Other local effects/outbox and
terminal receipt commit together. Unrelated account/auth/config epoch changes have
been removed; existing authority owners and scope/row locks remain.

| Evidence                                                          | Observed result / required gate                                                                                                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Default route wiring, claim/failure protocol and operator command | Implemented and exercised by the recorded native matrix                                                                                                                              |
| Full migration catalog                                            | 176 combined directories; three webhook migrations, both latest-row indexes and attested request retry; existing SQL checksums retained                                              |
| Signed HTTP/Prisma/PostgreSQL/outbox and recovery matrix          | **160/160 tests in 13 suites, zero skips**, on `7bb2a59d`; recorded 170 → 172 rehearsal. Subsequent combined changes require the current 170 → 176 gate                              |
| Focused units and harness                                         | **127/127 in 15 files**, zero skips, on `10b0e513`; its only later change before `7bb2a59d` was a PostgreSQL-only seed correction                                                    |
| Format / lint / architecture / scoped types                       | The 11-file follow-up and fixture corrections passed native format/lint; 705-file boundary check passed on `27933d3b`; feature/tooling types passed before the final seed correction |
| Exact runbook SQL                                                 | Disposable PostgreSQL 17.10 proof passed for the unchanged documented SQL after 172 migrations: CAS, refresh/stale denial, cache isolation, UTC and repeat checks                    |
| Whole-API types, API build and compiled CLI                       | Required exact-source gates; resource-interrupted attempts are not passes. Five dependency builds passed on `27933d3b`                                                               |
| Receipt-order query plans                                         | Required actual-query `EXPLAIN` regression in the existing migration suite; no forced planner settings or elapsed-time assertions                                                    |
| Protected merge                                                   | Requires current-head `Quality Gates` and `Dedicated Release Authority PG17 contract`, an up-to-date branch and resolved blocking findings                                           |
| Production replay or fleet qualification                          | Not executed; separately authorized operational work                                                                                                                                 |

The native run used PostgreSQL 17.10, Node 26.11.1, pnpm 11.28.7, TypeScript 7.0.2,
Prisma 7.9.0 and Vitest 4.1.10 with the frozen root/API dependency graph, verified
exact pinned runtime artifact and isolated Prisma client generation. Tokyo and
Honolulu sessions exercise the UTC timestamp contract in both offset directions.
The lock-wait expiry regression requires the actual reconciliation error.

The `3e017ec2` checkpoint and prototype/shim-based results at `783409f2` remain
historical; they do not certify later changes. Interrupted compiler attempts
(`SIGKILL` or a resource guard) and queued/skipped CI are not passing evidence.
No deployment status changed. The current PR validation and its exact-head checks
record the final implementation qualification; select that reviewed source before
an operational rollout.

## Applicability and prerequisites

- Select an exact release containing the final independently reviewed and tested PR
  source, using the [existing release process](../operations/07-environments-and-release-management.md).
- Reconcile the actual fleet, migration ledger, application/maintenance roles and
  unfinished deployment tasks. Use the approved migration authority; preserve the
  existing historical-migration checksum/cutover policy.
- Apply the three additive migrations through that approved path. Verify checks,
  primary/foreign keys, receipt trigger, both receipt-order indexes and exact checksums. Verify the real API
  and recovery roles have the required privileges on the new tables; a synthetic
  limited-role test is not proof of production grants. Every role that can update or
  delete `GitHubWebhookDelivery`, including legacy API, maintenance and rollback
  roles, must retain `SELECT` on `GitHubWebhookFence`. The receipt trigger runs
  with the caller's privileges and reads the fence even for an unfenced receipt.
  Apply this grant after expansion and before any writer resumes; retain it through
  application rollback. It grants neither fence writes nor a terminal-write bypass.
- Confirm trusted `GITHUB_APP_ID`, matching webhook secret/API origin and
  `GITHUB_APP_SLUG`. Existing review-ingress/conflict settings still apply.
  Recovery additionally requires the configured App private key and database URL;
  its client supports only `https://api.github.com`.
- Keep old unfenced deliveries. Do not backfill fences or claim unknown legacy
  effects. Fenced processed duplicates succeed only for the exact App/body/event
  identity; unfenced legacy rows are not automatically adopted.
- New lifecycle/repository admissions preserve order after retained conflicting
  receipts, including legacy timestamps from non-UTC sessions. The ordered
  `receivedAt` can be ahead of wall time after a clock correction or cutover;
  lease deadlines still use the current database clock. Preserve the retained
  records and drain old writers rather than rewriting their timestamps.

## Ordered rollout

1. Verify the exact final SHA's full migration/HTTP race/recovery tests and ordinary
   required CI. Quiesce ingress and inventory/drain every old API/webhook writer,
   maintenance writer and open transaction before takeover-capable code starts.
   A lease timeout or receipt trigger does not prove an old effect stopped.
2. Perform the approved schema expansion and privilege verification before any
   writer resumes. Build both `000168` receipt-order indexes while writers remain
   quiesced; verify their `indisvalid` and `indisready` catalog flags. These ordinary
   index builds belong to this drained phase. Include the fence read grant for
   legacy and rollback roles, then record migration checksums, index and role
   evidence before the new API serves.
3. Install the qualified API version and verify all relevant processes use it.
   Fenced processing is the default composition; there is no new activation flag.
4. Reopen ingress only after the writer drain/version checks. Use an authorized
   disposable repository for signed event and outbox verification, then record
   actual version/image, timestamps and durable evidence before widening.
5. Perform any real recovery only as a separately authorized, known-delivery
   operation. Retain unresolved and superseded receipts for reconciliation.

## Known-delivery recovery

After building the API with the pinned toolchain, use the existing operator
environment. Supply one exact GUID and numeric GitHub delivery ID:

```sh
pnpm webhook:recover inspect --delivery-guid GUID --github-delivery-id ID
pnpm webhook:recover request --delivery-guid GUID --github-delivery-id ID
pnpm webhook:recover reconcile --delivery-guid GUID --github-delivery-id ID
```

These examples are procedures, not a record of execution. `inspect` is read-only.
`request` validates the authenticated local receipt and trusted GitHub delivery
metadata/signature digest, then durably reserves at most one POST. `reconcile`
never sends POST; it can update local custody to confirmed after exact receiver
readback. A missing/redacted/rotated signature or unknown original fails closed.
An unavailable detail preflight also reports `not_authorized`; only bounded poll
observations distinguish rate limits/incompleteness.

HTTP 202, GitHub list status 200 and a lost response are not completion. Repeated
invocations retain `issued_unknown`/accepted custody and cannot request a second
POST. Never reset an issued intent to prepared. Only exact processed receiver
identity confirms recovery. A local `processed` result with
`githubDeliveryIdBound: false` does not prove the supplied numeric ID's association.

A later/equal locally received lifecycle/same-repository event blocks an older
installation/repository retry. Missing identity is conservative. This compares local
receipt order, not GitHub chronology. Authorization revocation has no retained
original grant revision. Its first delivery checks the current token with a bounded
read-only GitHub request, then permits revocation only for a refused, still-current,
unrefreshed and sufficiently unexpired snapshot under the auth owner's row lock.
Use a fresh UTC database clock for the UTC timestamp-without-timezone columns.
A valid current token is retained; ambiguous outcomes require reconciliation and
leave existing authorization/cache policy in place. A replacement GUID is not proof
of a fresh revocation. Automatic authorization retry remains unsupported.
Never-ingressed and unfenced legacy deliveries are unsupported.

### Exact-grant authorization reconciliation

A null token expiry cannot distinguish a revoked grant from an expired or
reconnected token. The webhook deliberately retains that grant and its cache;
replaying the delivery does not resolve the ambiguity. Before rollout, assign an
operator for these incidents and use the following separately authorized procedure.
The delivery recovery CLI does not perform this authorization-owner operation.

1. Record the environment, exact App slug, numeric GitHub user ID and delivery GUID.
   Read the current `GitHubUserAuthorization` joined to its `User`. Capture the
   grant `id`, `userId`, `githubUserId`, `appSlug`, `revision`, expiry,
   `revokedAt` and `refreshAttemptId`; the two user identities must agree. Do not
   record tokens or encrypted credentials in logs or the incident record.
2. Establish the state of this current grant through the existing auth owner. A
   fresh, bounded GitHub check accepting the captured token and returning the
   expected numeric user ID supports retaining it. An old webhook, a replacement
   GUID or an isolated 401 for a token with unknown expiry does not authorize
   revocation. If the evidence remains ambiguous, obtain an explicit decision from
   the connection owner to reconnect or disconnect this exact connection.
3. For reconnect, use the existing OAuth flow. Verify the new revision and current
   token through the auth owner; do not apply the old incident to that replacement
   revision. For retention, record the verification outcome and keep the current
   grant. For a confirmed revocation or explicitly authorized disconnect, capture
   the approved grant identity and revision, then use the bounded transaction below.
   An active refresh or any identity/revision change requires a fresh assessment.
4. Check the transaction result before committing: exactly one grant must change
   and its revision must advance by one. The cache deletion is tied to that changed
   grant's user and App; other Apps and users are untouched. Zero changed rows,
   timeout or any error means rollback and re-read, not an unconditional update.
   After commit, read back the exact grant and confirm that its matching permission
   cache is absent and that a new authorization read reports the revoked state.
5. Record the approving owner/operator, evidence and decision, old/new revision,
   cache count, UTC time and readback result in the incident and environment's
   execution record. Retain the webhook receipt, fence and custody as evidence.
   This grant reconciliation does not itself prove webhook receiver completion;
   do not mark the receipt processed, reset custody or issue another POST.

The following is an operator procedure, not an executed migration or a new command.
Use an approved PostgreSQL session and bind the five `psql` variables to the
reviewed, current grant; never substitute a broad user/App-only predicate. It uses
the existing auth owner's revision and App-scoped cache-invalidation policy, with
the grant ID additionally pinned for this manual operation. Acquire its row lock
before the update/delete statement: permission-cache writers hold the auth owner's
shared lock, so the next READ COMMITTED statement sees their committed cache rows.

```sql
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

SELECT id FROM "GitHubUserAuthorization"
WHERE id = :'grant_id' FOR UPDATE;

WITH changed AS (
  UPDATE "GitHubUserAuthorization"
  SET "revokedAt" = (clock_timestamp() AT TIME ZONE 'UTC'),
      revision = revision + 1,
      "refreshAttemptId" = NULL,
      "lastErrorCode" = 'github_app_authorization_manual_reconciliation',
      "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')
  WHERE id = :'grant_id'
    AND "userId" = :'user_id'
    AND "githubUserId" = :'github_user_id'::bigint
    AND "appSlug" = :'app_slug'
    AND revision = :'expected_revision'::integer
    AND "revokedAt" IS NULL
    AND "refreshAttemptId" IS NULL
  RETURNING "userId", "appSlug", revision
), invalidated AS (
  DELETE FROM "RepositoryPermissionCache" cache
  USING changed target_grant
  WHERE cache."userId" = target_grant."userId"
    AND cache."authorizationAppSlug" = target_grant."appSlug"
  RETURNING cache.id
)
SELECT (SELECT count(*) FROM changed) AS grants_changed,
       (SELECT min(revision) FROM changed) AS new_revision,
       (SELECT count(*) FROM invalidated) AS caches_invalidated;
-- COMMIT only for grants_changed = 1 and the expected next revision.
-- Otherwise ROLLBACK; an error or idle timeout also requires a fresh assessment.
```

## Verification and completion

Require successful final-source execution of every mandatory PostgreSQL suite,
zero skipped tests in that qualification, exact migration checksums and real
application-role checks. Exercise all six signed HTTP families, duplicate/mismatch,
active and expired owner, rollback, concurrent takeover, stale completion/failure/
renewal, old-writer rejection, PR ingress persistence and policy changes. Recovery
must prove one POST, unknown response retention and exact receiver completion.

Deployment completion additionally requires the actual fleet drain/version proof,
configured App identity, grants, live disposable-repository verification and durable
per-environment evidence. No local test proves a production fleet was drained.

## Retry, partial completion, and rollback

Before resuming, inspect migration history, receipts/fences/custody and actual
process versions. Unknown reservation/POST outcomes remain unknown; use reconcile.
Do not issue a replacement GUID or delete state to bypass the retained decision.

On application rollback, close admission and drain fenced work before any legacy
binary returns. Keep the receipt trigger, fences, custody, terminal records and
`SELECT` on `GitHubWebhookFence` for every receipt-writing role. Do not roll back
by dropping additive data or restoring an unsafe old writer.
The trigger rejects old terminal overwrites, but does not undo their earlier
unguarded effects. If the drain cannot be proved, keep admission closed.

## Related links

- [Completion plan and exact local-effect inventory](../architecture/2026-11-27-webhook-delivery-fencing.md).
- [Quality gates](../operations/03-quality-gates.md).
- [PR #1026](https://github.com/777genius/review-router-ai/pull/1026): duplicate
  acknowledgement contract; production here requires an exact fenced terminal.
- [PR #1021](https://github.com/777genius/review-router-ai/pull/1021): separate worker,
  transport and broader reliability work; not imported or qualified by this PR.

## Execution log

| Time (UTC)   | Environment          | Operator   | Actual version / image | Step and observed result                                            | Evidence                                  | Next action                                                                |
| ------------ | -------------------- | ---------- | ---------------------- | ------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| Not executed | staging / production | Unassigned | Not verified           | Source/test implementation only; no operational rollout or recovery | PR #1027 source and pending qualification | Finish final-source gates, then a separately authorized controlled rollout |
