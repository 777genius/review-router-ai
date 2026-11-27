# Durable GitHub webhook delivery: deployment

- Task ID: `2026-11-27-webhook-effect-fence`.
- Goal: supported signed webhooks retain durable ownership, commit their local
  effects safely, and permit bounded recovery without duplicate redelivery requests.
- Affected targets: API and database; existing outbox workers retain ownership of
  external commands. Their compatibility must be checked during the fleet drain.
- Implementation: [PR #1027](https://github.com/777genius/review-router-ai/pull/1027).
- Qualified native checkpoint: `76f715cb57721558a6fff1dcf87696b7e2717c96`
  passed the full 142-test PostgreSQL matrix. Select the exact reviewed final source
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

| Evidence                                                                   | Observed result / required gate                                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Default route wiring, claim/failure protocol and explicit operator command | Implemented and exercised by the native matrix                                                                                             |
| Full migration catalog                                                     | 172 directories; two additive migrations, no experimental epoch migration                                                                  |
| Signed HTTP/Prisma/PostgreSQL/outbox and recovery matrix                   | **142/142 tests in all 13 suites, zero skips**, on `76f715cb`; actual 170 → 172 migration rehearsal                                        |
| Focused unit and harness suites                                            | **111/111 tests in 15 files**, zero skips                                                                                                  |
| Lint / formatting / architecture / scoped tooling types                    | 69 changed TypeScript files linted after fixture cleanup; formatting, 705-file architecture check and strict tooling types passed          |
| Whole-API/feature strict types, production build and compiled CLI          | Required exact-source gates; consult the current PR validation and CI results                                                              |
| Protected merge                                                            | Requires current-head `Quality Gates` and `Dedicated Release Authority PG17 contract`, an up-to-date branch and resolved blocking findings |
| Production replay or fleet qualification                                   | Not executed; separately authorized operational work                                                                                       |

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
- Apply the two additive migrations through that approved path. Verify checks,
  primary/foreign keys, receipt trigger and exact checksums. Verify the real API
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

## Ordered rollout

1. Verify the exact final SHA's full migration/HTTP race/recovery tests and ordinary
   required CI. Quiesce ingress and inventory/drain every old API/webhook writer,
   maintenance writer and open transaction before takeover-capable code starts.
   A lease timeout or receipt trigger does not prove an old effect stopped.
2. Perform the approved schema expansion and privilege verification before any
   writer resumes. Include the fence read grant for legacy and rollback roles, then
   record actual migration checksums and role evidence before the new API serves.
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
